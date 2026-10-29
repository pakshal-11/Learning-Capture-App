// Copies the platform-free core modules into the Edge Functions shared folder so Deno can import
// them. `node scripts/sync-core.mjs` writes; `--check` fails (for CI) if the copies are stale.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["srs.ts", "streak.ts"];
const from = (f) => join(root, "packages/core/src", f);
const to = (f) => join(root, "supabase/functions/_shared/core", f);
const check = process.argv.includes("--check");

let stale = 0;
for (const f of files) {
  const same = existsSync(to(f)) && readFileSync(from(f), "utf8") === readFileSync(to(f), "utf8");
  if (same) continue;
  stale++;
  if (!check) {
    mkdirSync(dirname(to(f)), { recursive: true });
    copyFileSync(from(f), to(f));
    console.log(`synced ${f}`);
  } else {
    console.error(`out of date: supabase/functions/_shared/core/${f}`);
  }
}
if (check && stale) {
  console.error("Run: node scripts/sync-core.mjs");
  process.exit(1);
}
if (!stale) console.log("core copies are up to date");
