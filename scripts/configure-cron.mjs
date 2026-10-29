// One-time per environment: tells the database's scheduled jobs (pg_cron) where the Edge Functions
// live and which shared secret to send. The same CRON_SECRET must be set as an Edge Function secret.
//   node scripts/configure-cron.mjs        (reads .env.test, or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CRON_SECRET)
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

const env = { ...process.env };
if (existsSync(".env.test")) {
  for (const line of readFileSync(".env.test", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !(line.slice(0, i) in env)) env[line.slice(0, i)] = line.slice(i + 1);
  }
}
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]) {
  if (!env[k]) throw new Error(`Missing ${k}`);
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { error } = await db.from("app_config").upsert({
  key: "functions",
  value: { url: `${env.SUPABASE_URL}/functions/v1`, cron_secret: env.CRON_SECRET },
});
if (error) throw error;
console.log("cron configured for", env.SUPABASE_URL);
