// Records a self-graded review (the online fallback and the offline replay path). No AI, no cap.
// Idempotent on review_id, and an event older than the entry's last review is logged without
// changing the schedule, so replaying an offline queue in any order is safe.
import { authenticate } from "../_shared/auth.ts";
import { json, readJson, serve } from "../_shared/http.ts";
import { recordReview } from "../_shared/review.ts";
import { ApplyReviewInput, parseInput } from "../_shared/schemas.ts";

serve(async (req) => {
  const { user, service } = await authenticate(req);
  const input = parseInput(ApplyReviewInput, await readJson(req));

  const review = await recordReview(service, {
    userId: user.id,
    entryId: input.entry_id,
    reviewId: input.review_id,
    grade: input.grade,
    source: "self",
    question: input.question,
    answer: input.answer,
    reviewedAt: input.reviewed_at ? new Date(input.reviewed_at) : undefined,
  });
  return json({ ok: true, review });
});
