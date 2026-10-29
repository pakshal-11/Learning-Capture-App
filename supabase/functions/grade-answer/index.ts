// Grades the learner's typed answer (Correct / Partly / Missed), then updates the review schedule.
// If AI is unavailable (cap reached or error) the client can fall back to self-grading via apply-review.
import { aiFailureBody, runTool } from "../_shared/ai.ts";
import { authenticate } from "../_shared/auth.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { GRADE_SYSTEM, profileLine, tools, wrap } from "../_shared/prompts.ts";
import { GradeInput, GradeResult, parseInput } from "../_shared/schemas.ts";
import { recordReview } from "../_shared/review.ts";

serve(async (req) => {
  const { user, db, service } = await authenticate(req);
  const input = parseInput(GradeInput, await readJson(req));

  // db acts as the user, so RLS guarantees this entry is theirs
  const { data: entry } = await db
    .from("entries").select("id, topic, key_idea, apply_it, raw_text")
    .eq("id", input.entry_id).is("deleted_at", null).maybeSingle();
  if (!entry) throw new HttpError(404, "Entry not found.", "not_found");
  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();

  const card = [
    `Topic: ${entry.topic ?? ""}`,
    `Key idea: ${entry.key_idea ?? entry.raw_text ?? ""}`,
    entry.apply_it ? `Apply it: ${entry.apply_it}` : "",
  ].filter(Boolean).join("\n");

  const out = await runTool({
    service,
    userId: user.id,
    action: "grade",
    system: GRADE_SYSTEM,
    user: `${profileLine(profile)}\n${wrap("entry", card)}\nQuestion asked: ${input.question}\n${wrap("answer", input.answer || "(no answer)")}`,
    tool: tools.grade,
    schema: GradeResult,
  });
  if (!out.ok) return json(aiFailureBody(out));

  const review = await recordReview(service, {
    userId: user.id,
    entryId: input.entry_id,
    reviewId: input.review_id,
    grade: out.data.grade,
    source: "ai",
    question: input.question,
    answer: input.answer,
    feedback: out.data.feedback,
    correctAnswer: out.data.correct_answer,
    nextQuestion: out.data.next_question,
  });

  return json({
    ok: true,
    grade: out.data.grade,
    feedback: out.data.feedback,
    correct_answer: out.data.correct_answer,
    next_question: out.data.next_question,
    review,
    quota: out.quota,
  });
});
