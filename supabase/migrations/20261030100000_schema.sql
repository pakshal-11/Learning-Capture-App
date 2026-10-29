-- Learning Log: schema, row-level security, grants.
-- Principle: every table has RLS on; clients only get the privileges they need (column-level
-- where a column is server-controlled); anon gets nothing; service_role (Edge Functions) bypasses RLS.

create extension if not exists vector with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role_type text check (role_type in ('student', 'professional')),
  field_of_study text,
  year text,
  profession text,
  industry text,
  role_title text,
  experience_level text,
  goals text[] not null default '{}',
  interests text[] not null default '{}',
  language text not null default 'English',
  reminder_times time[] not null default '{}',
  timezone text not null default 'Asia/Kolkata',
  is_adult_confirmed boolean not null default false,
  consent_version text,
  consent_at timestamptz,
  is_admin boolean not null default false,
  streak_current int not null default 0,
  streak_best int not null default 0,
  last_review_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_text_len check (
    char_length(coalesce(field_of_study, '')) <= 200 and char_length(coalesce(profession, '')) <= 200
    and char_length(coalesce(industry, '')) <= 200 and char_length(coalesce(role_title, '')) <= 200
    and char_length(language) <= 60
  ),
  constraint profiles_reminder_count check (cardinality(reminder_times) <= 5)
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- A profile row is created automatically for every new auth user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------- entries
create table public.entries (
  id uuid primary key,                                   -- client-generated: makes sync retries idempotent
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_type text not null default 'text' check (source_type in ('text', 'url', 'screenshot', 'voice')),
  source_url text check (char_length(source_url) <= 2000),
  raw_text text not null default '' check (char_length(raw_text) <= 8000),
  topic text check (char_length(topic) <= 300),
  key_idea text check (char_length(key_idea) <= 2000),
  recall_question text check (char_length(recall_question) <= 1000),
  next_question text check (char_length(next_question) <= 1000),
  apply_it text check (char_length(apply_it) <= 2000),
  category text check (char_length(category) <= 100),
  language text,
  structure_state text not null default 'raw' check (structure_state in ('raw', 'structured')),
  -- server-controlled review state (clients cannot write these columns)
  status text not null default 'New' check (status in ('New', 'Reviewing', 'Mastered')),
  next_review timestamptz default (now() + interval '1 day'),
  times_reviewed int not null default 0,
  streak_correct int not null default 0,
  last_result text check (last_result in ('Correct', 'Partly', 'Missed')),
  last_reviewed_at timestamptz,
  learned_at timestamptz not null default now(),
  embedding extensions.vector(384),                      -- server-controlled
  fts tsvector generated always as (
    to_tsvector('simple', coalesce(topic, '') || ' ' || coalesce(key_idea, '') || ' ' || coalesce(raw_text, ''))
  ) stored,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                                 -- soft delete so other devices learn about it
);
create index entries_user_due_idx on public.entries (user_id, next_review) where deleted_at is null;
create index entries_user_updated_idx on public.entries (user_id, updated_at);
create index entries_fts_idx on public.entries using gin (fts);
create index entries_embedding_idx on public.entries using hnsw (embedding extensions.vector_cosine_ops);

-- Editing the text that feeds search clears the embedding so the background job refreshes it.
create or replace function public.entries_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.embedding is not distinct from old.embedding
     and (new.topic is distinct from old.topic or new.key_idea is distinct from old.key_idea
          or new.raw_text is distinct from old.raw_text) then
    new.embedding := null;
  end if;
  return new;
end $$;
create trigger entries_before_update before update on public.entries
  for each row execute function public.entries_before_update();

-- ----------------------------------------------------------------- reviews (append-only event log)
create table public.reviews (
  id uuid primary key,                                   -- client-generated for idempotent replay
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  question_shown text,
  user_answer text,
  grade text not null check (grade in ('Correct', 'Partly', 'Missed')),
  grade_source text not null check (grade_source in ('ai', 'self', 'stuck')),
  feedback text,
  correct_answer text,
  interval_days int,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index reviews_user_time_idx on public.reviews (user_id, reviewed_at desc);
create index reviews_entry_idx on public.reviews (entry_id);

-- ----------------------------------------------------------------- "I'm stuck"
create table public.problem_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query_text text not null check (char_length(query_text) <= 2000),
  candidate_ids uuid[] not null default '{}',
  result jsonb,
  created_at timestamptz not null default now()
);
create index problem_queries_user_idx on public.problem_queries (user_id, created_at desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query_id uuid not null references public.problem_queries (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  rating text not null check (rating in ('helped', 'partly', 'didnt')),
  created_at timestamptz not null default now(),
  unique (query_id, entry_id)
);

-- ----------------------------------------------------------------- usage + config
create table public.usage_log (
  id bigint generated always as identity primary key,
  -- set null (not cascade) on account deletion: keeps spend accounting, drops the personal link
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  status text not null default 'reserved' check (status in ('reserved', 'ok', 'error')),
  model text,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  tokens_cached int not null default 0,
  est_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index usage_log_user_time_idx on public.usage_log (user_id, created_at desc);
create index usage_log_time_idx on public.usage_log (created_at desc);

create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_config (key, value) values
  ('ai_limits', '{"enabled": true, "user_daily_calls": 30, "global_monthly_usd": 10, "reserve_cost_usd": 0.0005, "timezone": "Asia/Kolkata"}'),
  -- USD per million tokens, Claude Haiku 5.5 (prompts up to 100k tokens), checked 2026-10-30
  ('ai_pricing', '{"input": 0.10, "output": 0.50, "cache_write": 0.125, "cache_read": 0.01}')
on conflict (key) do nothing;

-- ----------------------------------------------------------------- push + reminders
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('expo', 'webpush')),
  token text not null check (char_length(token) <= 2000),   -- Expo token or web-push endpoint
  keys jsonb,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (user_id, token)
);

create table public.reminder_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  sent_date date not null,
  slot time not null,
  created_at timestamptz not null default now(),
  primary key (user_id, sent_date, slot)
);

-- ----------------------------------------------------------------- schema-only (NOT built; inert)
create table public.shared_entries (
  id uuid primary key default gen_random_uuid(),
  consent boolean not null default false,
  cleaned_text text,
  category text,
  profile_tags jsonb,
  embedding extensions.vector(384),
  quality_score real,
  created_at timestamptz not null default now()
);
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  domain text,
  title text,
  summary text,
  content_hash text,
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id uuid references public.entries (id) on delete cascade,
  kind text not null check (kind in ('video', 'screen_recording', 'audio')),
  storage_path text,
  duration_ms int,
  transcript text,
  created_at timestamptz not null default now()
);

-- ================================================================= RLS
alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.reviews enable row level security;
alter table public.problem_queries enable row level security;
alter table public.feedback enable row level security;
alter table public.usage_log enable row level security;
alter table public.app_config enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_log enable row level security;
alter table public.shared_entries enable row level security;
alter table public.sources enable row level security;
alter table public.media enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy entries_select_own on public.entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy entries_insert_own on public.entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy entries_update_own on public.entries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy reviews_select_own on public.reviews for select to authenticated
  using ((select auth.uid()) = user_id);
create policy problem_queries_select_own on public.problem_queries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy feedback_select_own on public.feedback for select to authenticated
  using ((select auth.uid()) = user_id);
create policy usage_log_select_own on public.usage_log for select to authenticated
  using ((select auth.uid()) = user_id);

create policy push_select_own on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy push_insert_own on public.push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy push_update_own on public.push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy push_delete_own on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- app_config, reminder_log, shared_entries, sources, media: RLS on, no policies = no client access.

-- ================================================================= grants
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (role_type, field_of_study, year, profession, industry, role_title, experience_level,
              goals, interests, language, reminder_times, timezone, is_adult_confirmed,
              consent_version, consent_at) on public.profiles to authenticated;

grant select on public.entries to authenticated;
grant insert (id, user_id, source_type, source_url, raw_text, topic, key_idea, recall_question,
              next_question, apply_it, category, language, structure_state, learned_at,
              client_updated_at, deleted_at) on public.entries to authenticated;
grant update (source_type, source_url, raw_text, topic, key_idea, recall_question, next_question,
              apply_it, category, language, structure_state, learned_at, client_updated_at,
              deleted_at) on public.entries to authenticated;

grant select on public.reviews, public.problem_queries, public.feedback, public.usage_log to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

grant all on all tables in schema public to service_role;
