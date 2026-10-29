-- Scheduled jobs. Edge Function calls need app_config 'functions' = {"url": ..., "cron_secret": ...},
-- set once per environment (see docs/DEPLOY.md); until then call_edge_function() is a no-op.

select cron.schedule('embed-pending-entries', '*/5 * * * *', $$select public.call_edge_function('embed-entries')$$);
select cron.schedule('dispatch-reminders', '*/5 * * * *', $$select public.call_edge_function('dispatch-reminders')$$);

-- Housekeeping: hard-delete tombstones after 30 days (devices have synced by then); trim old logs.
select cron.schedule('purge-deleted-entries', '15 3 * * *',
  $$delete from public.entries where deleted_at < now() - interval '30 days'$$);
select cron.schedule('purge-reminder-log', '20 3 * * *',
  $$delete from public.reminder_log where created_at < now() - interval '14 days'$$);
