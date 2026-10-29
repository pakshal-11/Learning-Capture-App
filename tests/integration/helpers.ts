import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv(): Record<string, string> {
  const file = join(process.cwd(), ".env.test");
  const fromFile: Record<string, string> = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0) fromFile[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { ...fromFile, ...(process.env as Record<string, string>) };
}

const env = loadEnv();
for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"]) {
  if (!env[k]) throw new Error(`Missing ${k}. Create .env.test (see docs/TESTING.md).`);
}

export const URL = env.SUPABASE_URL!;
export const ANON = env.SUPABASE_ANON_KEY!;
export const CRON_SECRET = env.CRON_SECRET!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/** Bypasses RLS: used only to set up and verify state. */
export const admin: SupabaseClient = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY!, opts);
/** Not signed in. */
export const anon: SupabaseClient = createClient(URL, ANON, opts);

export interface TestUser {
  id: string;
  email: string;
  db: SupabaseClient;
  token: string;
}

export async function makeUser(label: string): Promise<TestUser> {
  const email = `it-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(URL, ANON, opts);
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error ?? new Error("no session");
  return { id: created.data.user.id, email, db, token: signed.data.session.access_token };
}

export async function deleteUser(u: TestUser | undefined) {
  if (u) await admin.auth.admin.deleteUser(u.id);
}

export interface FnResult {
  status: number;
  json: any;
  headers: Headers;
}

/** Calls an Edge Function as a user (or with arbitrary headers). */
export async function callFn(
  name: string,
  body: unknown,
  who?: TestUser | { headers: Record<string, string> } | null,
  method = "POST",
): Promise<FnResult> {
  const headers: Record<string, string> = { "content-type": "application/json", apikey: ANON };
  if (who && "token" in who) headers.authorization = `Bearer ${who.token}`;
  else if (who) Object.assign(headers, who.headers);
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}

export const uuid = () => randomUUID();

/** Inserts an entry as the user (client-side columns only). */
export async function addEntry(u: TestUser, fields: Record<string, unknown> = {}) {
  const id = uuid();
  const { error } = await u.db.from("entries").insert({
    id,
    raw_text: "raw note",
    topic: "Test topic",
    key_idea: "Test key idea",
    recall_question: "What is the test key idea?",
    structure_state: "structured",
    ...fields,
  });
  if (error) throw error;
  return id;
}

export async function getEntry(id: string) {
  const { data, error } = await admin.from("entries").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
