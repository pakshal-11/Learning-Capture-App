// Creates the key pair that web push reminders need and keeps it in .vapid.json (git-ignored).
//   node scripts/make-vapid-keys.mjs                 create the keys (once) and print the PUBLIC key
//   node scripts/make-vapid-keys.mjs --set-secrets   also store them in Supabase (needs `supabase login` + link)
// The private key is never printed.
import { createECDH } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".vapid.json");
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

if (!existsSync(file)) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  writeFileSync(file, JSON.stringify({ publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) }, null, 2));
  console.log("Created .vapid.json");
}
const keys = JSON.parse(readFileSync(file, "utf8"));
console.log(`Public key (goes in apps/app/.env as EXPO_PUBLIC_VAPID_PUBLIC_KEY):\n${keys.publicKey}`);

if (process.argv.includes("--set-secrets")) {
  const cli = process.platform === "win32" ? "supabase.cmd" : "supabase";
  execFileSync(
    cli,
    ["secrets", "set", `VAPID_PUBLIC_KEY=${keys.publicKey}`, `VAPID_PRIVATE_KEY=${keys.privateKey}`, "VAPID_SUBJECT=mailto:pakshal@bananaclub.co.in"],
    { stdio: "inherit", cwd: root, shell: process.platform === "win32" },
  );
  console.log("Stored in Supabase secrets.");
}
