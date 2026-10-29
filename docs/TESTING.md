# Testing

## Unit tests (fast, no network)

```bash
pnpm test          # scheduling + daily streak logic (packages/core)
pnpm typecheck
node scripts/sync-core.mjs --check
```

Edge Function type check (needs Deno; CI does this):

```bash
cd supabase/functions && deno check --no-config --node-modules-dir=auto */index.ts
```

## Integration tests (real dev Supabase project)

`pnpm test:integration` runs 38 checks against the linked project using throwaway users (created and deleted by the test):

- row-level security: users cannot read, change or forge each other's rows; clients cannot write review state, embeddings, `is_admin`, usage or config; schema-only tables are unreachable; signed-out visitors get nothing
- review scheduling endpoint: intervals, idempotent replay, late offline events, Missed reset, Partly, Mastered after 5, ownership
- AI functions (real Haiku calls, roughly $0.003 per run): structuring, prompt-injection resistance, grading, question variants, "I'm stuck" (relevant, nothing-relevant, own-entries-only, Helped counts once), usage logging
- spending caps: per-user limit exact under concurrent calls, global cap message, kill switch
- admin view, reminders (claimed once, never twice), export (own data only), delete account

Setup: create `.env.test` in the project root (git-ignored) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`. These are NOT committed. The tests temporarily change `app_config.ai_limits`
and restore it afterwards.

Why not mock Anthropic? Calls cost a fraction of a cent, and a real call also proves the key, model id, tool schema and
caching work. The Haiku-specific logic that can be tested offline (cost maths, validation) lives in `_shared/` and is
exercised by these tests.
