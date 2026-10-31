import type { WebSource } from "./api";

export const WEB_MARKER = "— Added from the web —";
const MAX_RAW = 8000; // the database limit for entries.raw_text

/** The researched content, labelled so it is never mistaken for the learner's own words, with its source links. */
export function webBlock(details: string, sources: WebSource[]): string {
  const links = sources.map((s) => `- ${s.title}: ${s.url}`).join("\n");
  return `${WEB_MARKER}\n${details.trim()}${links ? `\n\nSources:\n${links}` : ""}`;
}

/** Appends the web block to the note text (replacing an earlier one), keeping the whole under the storage limit. */
export function withWebBlock(raw: string, details: string, sources: WebSource[]): string {
  const base = raw.split(WEB_MARKER)[0]!.trimEnd();
  const block = webBlock(details, sources);
  const room = MAX_RAW - base.length - 2;
  return `${base}\n\n${block.slice(0, Math.max(0, room))}`.slice(0, MAX_RAW);
}
