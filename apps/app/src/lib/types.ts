import type { Grade, Status } from "@learning-log/core";

export type { Grade, Status };

export type SourceType = "text" | "url" | "screenshot" | "voice";

export interface Entry {
  id: string;
  source_type: SourceType;
  source_url: string | null;
  raw_text: string;
  topic: string | null;
  key_idea: string | null;
  recall_question: string | null;
  next_question: string | null;
  apply_it: string | null;
  category: string | null;
  language: string | null;
  structure_state: "raw" | "structured";
  // server-controlled review state
  status: Status;
  next_review: string | null;
  times_reviewed: number;
  streak_correct: number;
  last_result: Grade | null;
  last_reviewed_at: string | null;
  learned_at: string;
  client_updated_at: string;
  deleted_at: string | null;
}

/** Columns the client may write (matches the column-level grants in the database). */
export const CONTENT_FIELDS = [
  "source_type", "source_url", "raw_text", "topic", "key_idea", "recall_question", "next_question",
  "apply_it", "category", "language", "structure_state", "learned_at", "client_updated_at", "deleted_at",
] as const;

/** Columns only the server may change; always taken from the server. */
export const SERVER_FIELDS = [
  "status", "next_review", "times_reviewed", "streak_correct", "last_result", "last_reviewed_at",
] as const;

export const ENTRY_COLUMNS = ["id", ...CONTENT_FIELDS, ...SERVER_FIELDS, "updated_at"].join(", ");

export interface Profile {
  id: string;
  role_type: "student" | "professional" | null;
  field_of_study: string | null;
  year: string | null;
  profession: string | null;
  industry: string | null;
  role_title: string | null;
  experience_level: string | null;
  goals: string[];
  interests: string[];
  language: string;
  reminder_times: string[]; // "HH:MM"
  timezone: string;
  is_adult_confirmed: boolean;
  consent_version: string | null;
  consent_at: string | null;
  is_admin: boolean;
  streak_current: number;
  streak_best: number;
  last_review_date: string | null;
}

export const CONSENT_VERSION = "2026-10-30";

export type Op =
  | { id: string; kind: "entry_create"; entryId: string; row: Record<string, unknown> }
  | { id: string; kind: "entry_update"; entryId: string; patch: Record<string, unknown> }
  | {
    id: string;
    kind: "review";
    entryId: string;
    payload: {
      review_id: string;
      entry_id: string;
      grade: Grade;
      question?: string;
      answer?: string;
      reviewed_at: string;
    };
  };
