// Feedback on an "I'm stuck" result. "Helped" counts as one Correct review of that entry
// (once per query + entry); "Partly" and "Didn't help" are only logged.
import { authenticate } from "../_shared/auth.ts";
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { recordReview } from "../_shared/review.ts";
import { parseInput, StuckFeedbackInput } from "../_shared/schemas.ts";

serve(async (req) => {
  const { user, db, service } = await authenticate(req);
  const input = parseInput(StuckFeedbackInput, await readJson(req));

  // RLS: both rows must belong to the caller
  const { data: query } = await db.from("problem_queries").select("id, candidate_ids")
    .eq("id", input.query_id).maybeSingle();
  if (!query || !(query.candidate_ids as string[]).includes(input.entry_id)) {
    throw new HttpError(404, "Result not found.", "not_found");
  }
  const { data: entry } = await db.from("entries").select("id").eq("id", input.entry_id).is("deleted_at", null).maybeSingle();
  if (!entry) throw new HttpError(404, "Entry not found.", "not_found");

  const { data: previous } = await service.from("feedback").select("rating")
    .eq("query_id", input.query_id).eq("entry_id", input.entry_id).maybeSingle();

  const { error } = await service.from("feedback").upsert(
    { user_id: user.id, query_id: input.query_id, entry_id: input.entry_id, rating: input.rating },
    { onConflict: "query_id,entry_id" },
  );
  if (error) throw error;

  let review = null;
  if (input.rating === "helped" && previous?.rating !== "helped") {
    review = await recordReview(service, {
      userId: user.id,
      entryId: input.entry_id,
      reviewId: crypto.randomUUID(),
      grade: "Correct",
      source: "stuck",
    });
  }
  return json({ ok: true, reinforced: review !== null, review });
});
