// Builds an iCalendar (.ics) file so a review can be added to any calendar app. Pure functions, no I/O.

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 says lines must be folded at 75 octets; fold by characters, which is safely under that for our text. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 70) {
    out.push(rest.slice(0, 70));
    rest = " " + rest.slice(70);
  }
  out.push(rest);
  return out.join("\r\n");
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

export interface ReviewEvent {
  id: string;
  title: string;
  /** When the review is due. */
  due: Date;
  /** Reminder time of day, "HH:MM" in the device's local time. If absent the event is all-day. */
  time?: string | null;
  note?: string;
}

/** One VEVENT. With a time it lasts 10 minutes and has an alarm at the start; without, it's an all-day event. */
export function reviewEventIcs(ev: ReviewEvent, now = new Date()): string {
  const lines = ["BEGIN:VEVENT", `UID:${ev.id}@learninglog.bananaclub.co.in`, `DTSTAMP:${stamp(now)}`];
  const m = ev.time?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (m) {
    const start = new Date(ev.due.getFullYear(), ev.due.getMonth(), ev.due.getDate(), Number(m[1]), Number(m[2]));
    lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + 10 * 60_000))}`);
  } else {
    const next = new Date(ev.due.getFullYear(), ev.due.getMonth(), ev.due.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(ev.due)}`, `DTEND;VALUE=DATE:${dateOnly(next)}`);
  }
  lines.push(`SUMMARY:${escapeText(`Review: ${ev.title}`)}`);
  if (ev.note) lines.push(`DESCRIPTION:${escapeText(ev.note)}`);
  if (m) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Time to review", "TRIGGER:PT0M", "END:VALARM");
  lines.push("END:VEVENT");
  return lines.map(fold).join("\r\n");
}

export function buildIcs(events: ReviewEvent[], now = new Date()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Banana Club//Learning Log//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.map((e) => reviewEventIcs(e, now)),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
