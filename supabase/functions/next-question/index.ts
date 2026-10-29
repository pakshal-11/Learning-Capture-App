// Generates a fresh recall question for an entry and stores it as the entry's next_question.
// Used when the entry has no stored variant (e.g. after a self-graded offline review).
import { aiFailureBody, runTool } from "../_shared/ai.ts";
import { authenticate } from "../_shared/auth.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { profileLine, tools, VARIANT_SYSTEM, wrap } from "../_shared/prompts.ts";
import { EntryIdInput, parseInput, QuestionVariant } from "../_shared/schemas.ts";

serve(async (req) => {
  const { user, db, service } = await authenticate(req);
  const input = parseInput(EntryIdInput, await readJson(req));

  const { data: entry } = await db
    .from("entries").select("id, topic, key_idea, apply_it, raw_text, recall_question, next_question")
    .eq("id", input.entry_id).is("deleted_at", null).maybeSingle();
  if (!entry) throw new HttpError(404, "Entry not found.", "not_found");
  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const { data: past } = await db
    .from("reviews").select("question_shown").eq("entry_id", input.entry_id)
    .order("reviewed_at", { ascending: false }).limit(5);

  const earlier = [entry.recall_question, entry.next_question, ...(past ?? []).map((r) => r.question_shown)]
    .filter((q): q is string => !!q);
  const card = `Topic: ${entry.topic ?? ""}\nKey idea: ${entry.key_idea ?? entry.raw_text ?? ""}`;

  const out = await runTool({
    service,
    userId: user.id,
    action: "variant",
    system: VARIANT_SYSTEM,
    user: `${profileLine(profile)}\n${wrap("entry", card)}\nEarlier questions:\n${earlier.map((q) => `- ${q}`).join("\n") || "- (none)"}`,
    tool: tools.variant,
    schema: QuestionVariant,
    maxTokens: 200,
  });
  if (!out.ok) return json(aiFailureBody(out));

  const { error } = await service.from("entries").update({ next_question: out.data.question })
    .eq("id", input.entry_id).eq("user_id", user.id);
  if (error) throw error;
  return json({ ok: true, question: out.data.question, quota: out.quota });
});
