// Validation for AI outputs (never trust model JSON) and for request inputs.
import { z } from "npm:zod@3";
import { HttpError } from "./http.ts";

// Over-long model fields are trimmed, not rejected: a retry costs money, a trim costs nothing.
const text = (max: number) => z.string().trim().min(1).transform((s) => s.slice(0, max));

export const StructuredNote = z.object({
  topic: text(120),
  key_idea: text(600),
  recall_question: text(400),
  apply_it: text(600),
  category: text(60),
  // True when the note names something but never says what it contains (the app then offers a web look-up).
  needs_research: z.boolean().optional().default(false),
});
export type StructuredNote = z.infer<typeof StructuredNote>;

// A study card built from web search results. `details` is the actual content found; `source_urls` are
// checked against the real search results before use, so the model cannot invent a link.
export const ResearchedNote = z.object({
  found: z.boolean(),
  topic: text(120),
  key_idea: text(600),
  recall_question: text(400),
  apply_it: text(600),
  category: text(60),
  details: z.string().trim().max(2500).optional().default(""),
  source_urls: z.array(z.string().max(2000)).max(8).optional().default([]),
});
export type ResearchedNote = z.infer<typeof ResearchedNote>;

export const GradeResult = z.object({
  grade: z.enum(["Correct", "Partly", "Missed"]),
  feedback: text(500),
  correct_answer: text(600),
  next_question: text(400),
});
export type GradeResult = z.infer<typeof GradeResult>;

export const QuestionVariant = z.object({ question: text(400) });

export const StuckPick = z.object({
  none_relevant: z.boolean(),
  message: z.string().trim().max(400).optional().default(""),
  matches: z.array(z.object({
    entry_id: z.string().uuid(),
    why: text(400),
    how_to_use: text(500),
  })).max(5).default([]),
});
export type StuckPick = z.infer<typeof StuckPick>;

// ---- request inputs
export const uuid = z.string().uuid();

export const StructureInput = z.object({
  raw_text: z.string().trim().min(3, "Add a little more text.").max(4000, "Keep it under 4,000 characters."),
});

export const GradeInput = z.object({
  entry_id: uuid,
  review_id: uuid,
  question: z.string().trim().min(1).max(1000),
  answer: z.string().max(2000),
});

export const ApplyReviewInput = z.object({
  review_id: uuid,
  entry_id: uuid,
  grade: z.enum(["Correct", "Partly", "Missed"]),
  question: z.string().max(1000).optional(),
  answer: z.string().max(2000).optional(),
  reviewed_at: z.string().datetime({ offset: true }).optional(),
});

export const StuckInput = z.object({
  problem: z.string().trim().min(3, "Describe the problem a little more.").max(1000, "Keep it under 1,000 characters."),
});

export const StuckFeedbackInput = z.object({
  query_id: uuid,
  entry_id: uuid,
  rating: z.enum(["helped", "partly", "didnt"]),
});

export const EntryIdInput = z.object({ entry_id: uuid });

/** Parse request input or throw a 400 with the first friendly message. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues[0]?.message ?? "Invalid request.";
    throw new HttpError(400, msg, "bad_request");
  }
  return r.data;
}
