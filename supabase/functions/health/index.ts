// Keep-alive: a scheduled GitHub Actions job calls this daily so the free Supabase project is never idle.
// Public on purpose and reveals nothing: it runs one trivial query and returns ok.
import { serviceClient } from "../_shared/auth.ts";
import { json, serve } from "../_shared/http.ts";

serve(async () => {
  const { error } = await serviceClient().from("app_config").select("key").limit(1);
  return json({ ok: !error, at: new Date().toISOString() }, error ? 503 : 200);
});
