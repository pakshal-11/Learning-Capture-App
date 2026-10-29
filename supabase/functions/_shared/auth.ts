import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

const url = () => Deno.env.get("SUPABASE_URL")!;

/** Service-role client: bypasses RLS. Only for the jobs the plan allows (usage_log, cron, deletes, ownership-checked writes). */
export function serviceClient(): SupabaseClient {
  return createClient(url(), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthedRequest {
  user: User;
  /** Acts as the user: RLS applies to everything it does. */
  db: SupabaseClient;
  service: SupabaseClient;
}

/** Verifies the bearer token with Supabase Auth and returns an RLS-bound client for that user. */
export async function authenticate(req: Request): Promise<AuthedRequest> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Please sign in.", "unauthorized");

  const service = serviceClient();
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in again.", "unauthorized");

  const db = createClient(url(), Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: data.user, db, service };
}
