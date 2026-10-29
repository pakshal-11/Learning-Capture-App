# Deploying the backend

Windows note: if PowerShell blocks `supabase` ("running scripts is disabled"), use `supabase.cmd`.

## First time, for a new Supabase project

1. `supabase login`, then `supabase link --project-ref <PROJECT_ID>`
2. `supabase db push --linked` applies everything in `supabase/migrations/`
3. Secrets (type them yourself; never commit or paste them in chat):
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set CRON_SECRET=<long random string>
   ```
   Optional: `ANTHROPIC_MODEL` (defaults to `claude-haiku-5-5`).
4. `supabase functions deploy`
5. Tell the database where the functions live (for the scheduled jobs). Put `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   and the same `CRON_SECRET` in `.env.test` (or the environment), then run `node scripts/configure-cron.mjs`.
6. Auth settings in the Supabase dashboard: enable Email (OTP), add a custom SMTP (Resend or Brevo free tier; the default
   sender allows only a few emails per hour), later enable Google. Set the Site URL and redirect URLs once the web app is hosted.
7. Keep-alive: in the GitHub repo, Settings > Secrets and variables > Actions > Variables, add
   `SUPABASE_FUNCTIONS_URL` = `https://<project-ref>.supabase.co/functions/v1`. The workflow `keepalive.yml` then pings `/health` daily.
8. Anthropic console: set a monthly spend limit (the app's own cap is $10/month by default, this is a second backstop).

## Updating

- Database: add a NEW file in `supabase/migrations/` (never edit one that has been applied), then `supabase db push --linked`.
- Functions: `node scripts/sync-core.mjs`, then `supabase functions deploy` (or `supabase functions deploy <name>`).

## Costs and limits to remember

- Haiku 5.5 is about $0.0002 per call at current prices; caps are in `app_config` (see BACKEND.md).
- Supabase free plan: pauses after 7 days idle (keep-alive handles it), no automatic backups, Edge Functions 2 s CPU per request.
