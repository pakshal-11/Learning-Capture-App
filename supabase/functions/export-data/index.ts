// "Export my data": everything the app holds about the caller, as one JSON download.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { authenticate } from "../_shared/auth.ts";
import { corsHeaders, serve } from "../_shared/http.ts";

const ENTRY_COLS = "id, source_type, source_url, raw_text, topic, key_idea, recall_question, next_question, apply_it, " +
  "category, language, structure_state, status, next_review, times_reviewed, streak_correct, last_result, " +
  "last_reviewed_at, learned_at, created_at, updated_at, deleted_at";

/** Reads every row of a table in pages (the API returns at most 1000 rows per request). */
async function fetchAll(db: SupabaseClient, table: string, cols: string, order: string) {
  const rows: unknown[] = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order(order).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

serve(async (req) => {
  const { user, db } = await authenticate(req);

  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile,
    entries: await fetchAll(db, "entries", ENTRY_COLS, "created_at"),
    reviews: await fetchAll(db, "reviews", "*", "reviewed_at"),
    problem_queries: await fetchAll(db, "problem_queries", "*", "created_at"),
    feedback: await fetchAll(db, "feedback", "*", "created_at"),
    usage_log: await fetchAll(db, "usage_log", "id, action, status, model, tokens_in, tokens_out, est_cost_usd, created_at", "created_at"),
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="learning-log-export.json"',
    },
  });
});
