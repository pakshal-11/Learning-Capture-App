// "I'm stuck": searches ONLY the caller's own entries (hybrid vector + keyword, under RLS), then asks
// Haiku to pick the 1-3 that genuinely help. Saying "nothing relevant" is a valid result.
import { aiFailureBody, runTool } from "../_shared/ai.ts";
import { authenticate } from "../_shared/auth.ts";
import { embedPending, embedText } from "../_shared/embed.ts";
import { json, readJson, serve } from "../_shared/http.ts";
import { profileLine, STUCK_SYSTEM, tools, wrap } from "../_shared/prompts.ts";
import { parseInput, StuckInput, StuckPick } from "../_shared/schemas.ts";

const NONE_MESSAGE =
  "Nothing you've saved clearly applies to this. Try describing it differently, or capture what you learn once you solve it.";

serve(async (req) => {
  const { user, db, service } = await authenticate(req);
  const input = parseInput(StuckInput, await readJson(req));

  // make sure recent captures are searchable before we search
  await embedPending(service, { userId: user.id, limit: 20 });

  const vector = await embedText(input.problem);
  const { data: found, error } = await db.rpc("match_entries", {
    query_embedding: JSON.stringify(vector),
    query_text: input.problem,
    match_count: 8,
  });
  if (error) throw error;
  const candidates = (found ?? []) as Array<{
    id: string; topic: string | null; key_idea: string | null; apply_it: string | null; recall_question: string | null;
  }>;

  const save = async (result: unknown) => {
    const { data } = await service.from("problem_queries").insert({
      user_id: user.id,
      query_text: input.problem,
      candidate_ids: candidates.map((c) => c.id),
      result,
    }).select("id").single();
    return data?.id as string | undefined;
  };

  if (candidates.length === 0) {
    const result = { none_relevant: true, matches: [], message: NONE_MESSAGE };
    return json({ ok: true, query_id: await save(result), ...result });
  }

  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const list = candidates.map((c) => ({
    id: c.id,
    topic: c.topic ?? "",
    key_idea: (c.key_idea ?? "").slice(0, 400),
    apply_it: (c.apply_it ?? "").slice(0, 300),
  }));

  const out = await runTool({
    service,
    userId: user.id,
    action: "stuck",
    system: STUCK_SYSTEM,
    user: `${profileLine(profile)}\n${wrap("problem", input.problem)}\n${wrap("entries", JSON.stringify(list))}`,
    tool: tools.stuck,
    schema: StuckPick,
    maxTokens: 700,
  });
  if (!out.ok) return json(aiFailureBody(out));

  // never trust model ids: keep only real candidates, at most 3
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const matches = out.data.none_relevant
    ? []
    : out.data.matches.filter((m) => byId.has(m.entry_id)).slice(0, 3).map((m) => {
      const e = byId.get(m.entry_id)!;
      return {
        entry_id: m.entry_id,
        topic: e.topic,
        key_idea: e.key_idea,
        apply_it: e.apply_it,
        why: m.why,
        how_to_use: m.how_to_use,
      };
    });

  const result = matches.length === 0
    ? { none_relevant: true, matches: [], message: out.data.message || NONE_MESSAGE }
    : { none_relevant: false, matches, message: "" };
  return json({ ok: true, query_id: await save(result), ...result, quota: out.quota });
});
