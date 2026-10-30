// Hands an .ics file to the user: a download on web, the system share sheet (Calendar, Gmail, ...) on Android/iOS.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { buildIcs, type ReviewEvent } from "./ics";

export async function addToCalendar(ev: ReviewEvent, filename = "learning-log-review.ics"): Promise<{ ok: boolean; message?: string }> {
  const ics = buildIcs([ev]);
  try {
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true };
    }
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(ics);
    if (!(await Sharing.isAvailableAsync())) return { ok: false, message: "Sharing isn't available on this device." };
    await Sharing.shareAsync(file.uri, { mimeType: "text/calendar", UTI: "public.calendar-event", dialogTitle: "Add to calendar" });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't create the calendar file." };
  }
}
