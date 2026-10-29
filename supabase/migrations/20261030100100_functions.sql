-- Learning Log: spending caps, retrieval, reminders, admin summary.

-- ------------------------------------------------------------ AI budget guard (service_role only)
-- Atomically checks the global monthly cap and the user's daily cap, then reserves a slot by
-- inserting a usage_log row with an estimated cost. complete_ai_call() fills in the real numbers.
create or replace function public.reserve_ai_call(p_user uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lim jsonb;
  tz text;
  day_start timestamptz;
  month_start timestamptz;
  cap_user int;
  cap_global numeric;
  reserve numeric;
  used int;
  spent numeric;
  log_id bigint;
begin
  select value into lim from app_config where key = 'ai_limits';
  if coalesce((lim ->> 'enabled')::boolean, true) = false then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  cap_user := coalesce((lim ->> 'user_daily_calls')::int, 30);
  cap_global := coalesce((lim ->> 'global_monthly_usd')::numeric, 10);
  reserve := coalesce((lim ->> 'reserve_cost_usd')::numeric, 0.0005);
  tz := coalesce(lim ->> 'timezone', 'Asia/Kolkata');

  perform pg_advisory_xact_lock(hashtext('reserve_ai_call'));  -- serialise: small scale, exact caps

  day_start := date_trunc('day', now() at time zone tz) at time zone tz;
  month_start := date_trunc('month', now() at time zone tz) at time zone tz;

  select coalesce(sum(est_cost_usd), 0) into spent from usage_log where created_at >= month_start;
  if spent >= cap_global then
    return jsonb_build_object('ok', false, 'reason', 'global_cap');
  end if;

  select count(*) into used from usage_log
   where user_id = p_user and created_at >= day_start and status <> 'error';
  if used >= cap_user then
    return jsonb_build_object('ok', false, 'reason', 'user_cap', 'used', used, 'limit', cap_user);
  end if;

  insert into usage_log (user_id, action, status, est_cost_usd)
  values (p_user, p_action, 'reserved', reserve) returning id into log_id;

  return jsonb_build_object('ok', true, 'log_id', log_id, 'used', used + 1, 'limit', cap_user);
end $$;

create or replace function public.complete_ai_call(
  p_id bigint, p_status text, p_model text,
  p_tokens_in int, p_tokens_out int, p_tokens_cached int, p_cost numeric
) returns void
language sql security definer set search_path = public, pg_temp as $$
  update usage_log
     set status = p_status, model = p_model, tokens_in = p_tokens_in, tokens_out = p_tokens_out,
         tokens_cached = p_tokens_cached, est_cost_usd = p_cost
   where id = p_id;
$$;

-- ------------------------------------------------------------ retrieval for "I'm stuck"
-- Keyword query: OR of the words (>= 4 chars) so a long problem statement still matches.
create or replace function public.or_tsquery(q text) returns tsquery
language sql immutable set search_path = public as $$
  select nullif(string_agg(quote_literal(w), ' | '), '')::tsquery
  from (
    select distinct w
    from regexp_split_to_table(lower(regexp_replace(q, '[[:punct:]]', ' ', 'g')), '\s+') as w
    where char_length(w) >= 4
  ) t
$$;

-- SECURITY INVOKER on purpose: runs as the caller, so RLS restricts it to the caller's own entries.
create or replace function public.match_entries(
  query_embedding extensions.vector(384), query_text text, match_count int default 8
) returns table (
  id uuid, topic text, key_idea text, apply_it text, recall_question text, similarity double precision, via text
)
language sql stable security invoker set search_path = public, extensions as $$
  with vec as (
    select e.id, (1 - (e.embedding <=> query_embedding))::double precision as score
    from entries e
    where e.deleted_at is null and e.embedding is not null
    order by e.embedding <=> query_embedding
    limit match_count
  ), txt as (
    select e.id
    from entries e
    where e.deleted_at is null and e.fts @@ or_tsquery(query_text)
    order by ts_rank(e.fts, or_tsquery(query_text)) desc
    limit 5
  )
  select e.id, e.topic, e.key_idea, e.apply_it, e.recall_question,
         coalesce(v.score, 0), case when v.id is not null and t.id is not null then 'both'
                                    when v.id is not null then 'vector' else 'text' end
  from entries e
  left join vec v on v.id = e.id
  left join txt t on t.id = e.id
  where v.id is not null or t.id is not null
  order by coalesce(v.score, 0) desc
  limit match_count + 3
$$;

-- ------------------------------------------------------------ reminders (service_role only)
-- Finds users whose reminder time fell in the last 10 minutes (their local time), who have a push
-- subscription and due entries, and records the slot so it is never sent twice.
create or replace function public.claim_due_reminders(p_now timestamptz default now())
returns table (user_id uuid, due_count int)
language sql security definer set search_path = public, pg_temp as $$
  with cand as (
    select p.id as uid, p.timezone as tz, s.slot, (p_now at time zone p.timezone) as local_now
    from profiles p
    cross join lateral unnest(p.reminder_times) as s(slot)
    where exists (select 1 from push_subscriptions ps where ps.user_id = p.id)
      and exists (select 1 from pg_timezone_names n where n.name = p.timezone)
  ), due as (
    select * from cand
    where (local_now::time - slot) >= interval '0' and (local_now::time - slot) < interval '10 minutes'
  ), claimed as (
    insert into reminder_log (user_id, sent_date, slot)
    select uid, local_now::date, slot from due
    on conflict do nothing
    returning reminder_log.user_id, reminder_log.sent_date, reminder_log.slot
  )
  select c.user_id,
         (select count(*)::int from entries e
           where e.user_id = c.user_id and e.deleted_at is null and e.next_review is not null
             and e.next_review < ((date_trunc('day', d.local_now) + interval '1 day') at time zone d.tz)) as due_count
  from claimed c
  join due d on d.uid = c.user_id and d.slot = c.slot
$$;

-- ------------------------------------------------------------ admin usage view
create or replace function public.admin_usage_summary(p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lim jsonb;
  tz text;
  month_start timestamptz;
  result jsonb;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select value into lim from app_config where key = 'ai_limits';
  tz := coalesce(lim ->> 'timezone', 'Asia/Kolkata');
  month_start := date_trunc('month', now() at time zone tz) at time zone tz;

  select jsonb_build_object(
    'limits', lim,
    'month', (select jsonb_build_object(
        'calls', count(*), 'tokens_in', coalesce(sum(tokens_in), 0), 'tokens_out', coalesce(sum(tokens_out), 0),
        'tokens_cached', coalesce(sum(tokens_cached), 0), 'cost_usd', coalesce(sum(est_cost_usd), 0),
        'active_users', count(distinct user_id))
      from usage_log where created_at >= month_start),
    'by_day', coalesce((select jsonb_agg(r order by r.day) from (
        select (created_at at time zone tz)::date as day, count(*) as calls, sum(est_cost_usd) as cost_usd
        from usage_log where created_at >= now() - make_interval(days => p_days) group by 1) r), '[]'),
    'by_action', coalesce((select jsonb_agg(r) from (
        select action, count(*) as calls, sum(est_cost_usd) as cost_usd
        from usage_log where created_at >= month_start group by 1 order by 3 desc) r), '[]'),
    'top_users', coalesce((select jsonb_agg(r) from (
        select user_id, count(*) as calls, sum(est_cost_usd) as cost_usd
        from usage_log where created_at >= month_start and user_id is not null
        group by 1 order by 3 desc limit 10) r), '[]'),
    'total_users', (select count(*) from profiles)
  ) into result;
  return result;
end $$;

-- ------------------------------------------------------------ cron plumbing
-- Calls an Edge Function from pg_cron using the URL + shared secret stored in app_config ('functions').
create or replace function public.call_edge_function(p_name text) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare cfg jsonb;
begin
  select value into cfg from app_config where key = 'functions';
  if cfg is null then return; end if;
  perform net.http_post(
    url := (cfg ->> 'url') || '/' || p_name,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', cfg ->> 'cron_secret'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;

-- ------------------------------------------------------------ function privileges
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.reserve_ai_call(uuid, text) to service_role;
grant execute on function public.complete_ai_call(bigint, text, text, int, int, int, numeric) to service_role;
grant execute on function public.claim_due_reminders(timestamptz) to service_role;
grant execute on function public.call_edge_function(text) to service_role;
grant execute on function public.or_tsquery(text) to authenticated, service_role;
grant execute on function public.match_entries(extensions.vector, text, int) to authenticated, service_role;
grant execute on function public.admin_usage_summary(int) to authenticated, service_role;
