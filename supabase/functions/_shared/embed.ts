// Embeddings with Supabase's built-in gte-small model (384 dims, English-first, free, no API key).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, opts: object) => Promise<number[]> } };
};

let session: { run: (input: string, opts: object) => Promise<number[]> } | null = null;

export async function embedText(text: string): Promise<number[]> {
  session ??= new Supabase.ai.Session("gte-small");
  return await session.run(text.slice(0, 2000), { mean_pool: true, normalize: true });
}

interface EntryText {
  topic: string | null;
  key_idea: string | null;
  apply_it: string | null;
  raw_text: string | null;
}

/** What gets embedded: the structured card if there is one, otherwise the raw note. */
export function entryEmbedText(e: EntryText): string {
  const card = [e.topic, e.key_idea, e.apply_it].filter(Boolean).join(". ");
  return (card || e.raw_text || "").trim();
}

/** Embeds entries that have no embedding yet (new or edited). Returns how many were updated. */
export async function embedPending(service: SupabaseClient, opts: { userId?: string; limit: number }): Promise<number> {
  let q = service
    .from("entries")
    .select("id, topic, key_idea, apply_it, raw_text")
    .is("embedding", null)
    .is("deleted_at", null)
    .limit(opts.limit);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data, error } = await q;
  if (error || !data) {
    console.error("embedPending select failed", error);
    return 0;
  }

  let done = 0;
  for (const e of data) {
    const text = entryEmbedText(e);
    if (!text) continue;
    const vector = await embedText(text);
    const { error: upErr } = await service.from("entries").update({ embedding: JSON.stringify(vector) }).eq("id", e.id);
    if (upErr) console.error("embed update failed", e.id, upErr.message);
    else done++;
  }
  return done;
}
