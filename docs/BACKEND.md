# Backend reference (Phase 1)

Supabase project: Postgres + pgvector, Auth, Edge Functions, pg_cron. All AI goes through Edge Functions.

## Edge Functions

All take `POST` JSON with `Authorization: Bearer <user access token>` unless noted. Errors are `{ok:false, error, message}`
with 400 (bad input), 401 (not signed in), 404 (not found / not yours) or 500.

AI functions return **HTTP 200** `{ok:false, unavailable:true, reason, message, quota}` when a spending cap is hit
(`reason`: `user_cap`, `global_cap`, `disabled`), and `{ok:false, unavailable:false, reason, message}` on an AI error.
Show `message` to the user. The client can then offer self-grading.

| Function | Input | Output | AI |
|---|---|---|---|
| `structure-note` | `{raw_text}` (3-4000 chars) | `{ok, note:{topic,key_idea,recall_question,apply_it,category}, quota}`. Nothing saved: the client previews, the user edits, the client inserts the entry. | yes |
| `grade-answer` | `{entry_id, review_id, question, answer}` | `{ok, grade, feedback, correct_answer, next_question, review, quota}`. Updates the schedule and stores `next_question` on the entry. | yes |
| `next-question` | `{entry_id}` | `{ok, question, quota}`. Stores it as `entries.next_question`. | yes |
| `find-stuck` | `{problem}` (3-1000 chars) | `{ok, query_id, none_relevant, matches:[{entry_id,topic,key_idea,apply_it,why,how_to_use}], message, quota}`. Own entries only. 0 matches = `none_relevant:true`. | yes (skipped when the user has no candidates) |
| `stuck-feedback` | `{query_id, entry_id, rating: helped\|partly\|didnt}` | `{ok, reinforced, review}`. `helped` = one Correct review, once per query+entry. | no |
| `apply-review` | `{review_id, entry_id, grade, question?, answer?, reviewed_at?}` | `{ok, review}`. Self-grade and offline replay. Idempotent on `review_id`; events older than the entry's last review are logged but do not change the schedule (`review.stale`). | no |
| `export-data` | none | JSON download of all the caller's data (no embeddings, no push tokens). | no |
| `delete-account` | `{confirm:"DELETE"}` | `{ok}`. Deletes the auth user; every table cascades. `usage_log` rows are kept with `user_id = null`. | no |
| `health` | none, no auth | `{ok, at}`. Keep-alive target. | no |
| `embed-entries` | cron only (`x-cron-secret`) | Embeds new/edited entries (also done on demand inside `find-stuck`). | no |
| `dispatch-reminders` | cron only (`x-cron-secret`) | Sends Expo push for due reviews at each user's reminder time. Web Push is added in Phase 2b. | no |

`review` result: `{duplicate, stale, entry:{id,status,next_review,times_reviewed,streak_correct,last_result,last_reviewed_at,next_question}, streak:{current,best}}`.

## Direct table access (supabase-js with the user's session, RLS enforced)

| Table | Client may |
|---|---|
| `profiles` | read own; update onboarding/settings columns only (not `is_admin`, streak fields) |
| `entries` | read own; insert/update content columns only (not status, next_review, counters, embedding); delete = set `deleted_at` |
| `reviews`, `problem_queries`, `feedback`, `usage_log` | read own |
| `push_subscriptions` | full access to own rows |
| `app_config`, `reminder_log`, `shared_entries`, `sources`, `media` | nothing |

RPC: `admin_usage_summary(p_days)` (admins only), `match_entries(...)` (used by `find-stuck`).

## Spending caps

`reserve_ai_call()` runs before every AI call. It atomically checks the global monthly spend and the user's daily call count
(Asia/Kolkata day/month), then reserves a `usage_log` row. `complete_ai_call()` writes real tokens and cost.
Limits live in `app_config` key `ai_limits`; prices in `ai_pricing`.

```sql
-- change limits (service role / SQL editor)
update app_config set value = value || '{"user_daily_calls": 20, "global_monthly_usd": 5}' where key = 'ai_limits';
-- kill switch
update app_config set value = value || '{"enabled": false}' where key = 'ai_limits';
```

## Making someone an admin

In the Supabase SQL editor: `update profiles set is_admin = true where id = '<user uuid>';`

## Scheduled jobs (pg_cron)

| Job | When | What |
|---|---|---|
| `embed-pending-entries` | every 5 min | calls `embed-entries` |
| `dispatch-reminders` | every 5 min | calls `dispatch-reminders` |
| `purge-deleted-entries` | daily | hard-deletes entries soft-deleted > 30 days ago |
| `purge-reminder-log` | daily | trims the reminder log |

The first two need `app_config` key `functions` (done by `node scripts/configure-cron.mjs`, see DEPLOY.md).

## Scheduling rules

See `packages/core/src/srs.ts` (and `srs.test.ts`). Correct: 1, 3, 7, 14, 30 days by consecutive-Correct count; 5 in a row = Mastered
(leaves the due queue). Partly: 2 days, streak unchanged. Missed: next day, streak reset. "Helped" = Correct.
`supabase/functions/_shared/core/` is a generated copy: run `node scripts/sync-core.mjs` after editing `packages/core`.

## Deviations from PLAN.md (all deliberate)

- No `register-push` function: clients insert their own row in `push_subscriptions` (RLS-protected), which is simpler and equally safe.
- No `admin-usage` function: the admin view is the `admin_usage_summary()` SQL function, callable only by admins.
- Embeddings use a "null embedding = needs embedding" flag plus a 5-minute cron and on-demand embedding in `find-stuck`, instead of a pgmq queue (fewer moving parts at this scale).
- `dispatch-reminders` sends Expo (Android) push only. Web Push sending lands with the PWA in Phase 2b.
- No separate pgTAP suite: row-level security is verified by the integration tests against the real database, which also cover Edge Function behaviour. pgTAP would need local Docker.
- Integration tests call the real Haiku model (about $0.003 per full run) instead of a mock.
