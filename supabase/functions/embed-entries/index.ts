// Background job (pg_cron, every 5 min): embeds new or edited entries so "I'm stuck" can search them.
import { serviceClient } from "../_shared/auth.ts";
import { embedPending } from "../_shared/embed.ts";
import { json, requireCronSecret, serve } from "../_shared/http.ts";

serve(async (req) => {
  requireCronSecret(req);
  const embedded = await embedPending(serviceClient(), { limit: 40 });
  return json({ ok: true, embedded });
});
