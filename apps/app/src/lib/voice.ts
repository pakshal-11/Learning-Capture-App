// Android: real on-device microphone dictation (Google's speech recogniser, prefers on-device when installed).
// iOS follows the same path but iOS is PWA-only in this build, so it never runs there.
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import { codesFor } from "./languages";

export const voiceSupported = Platform.OS === "android";

/** `onText(committed, partial)` is called as words come in; the screen shows base + committed + partial. */
export function useVoice(language: string, onText: (committed: string, partial: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const committed = useRef("");

  useSpeechRecognitionEvent("result", (e) => {
    const t = e.results[0]?.transcript ?? "";
    if (e.isFinal) {
      committed.current = `${committed.current} ${t}`.trim();
      onText(committed.current, "");
    } else {
      onText(committed.current, t);
    }
  });
  useSpeechRecognitionEvent("end", () => setListening(false));
  useSpeechRecognitionEvent("error", (e) => {
    setListening(false);
    if (e.error === "no-speech" || e.error === "aborted") return;
    setError(
      e.error === "not-allowed" ? "Microphone permission is off. Turn it on in Android Settings > Apps > Learning Log > Permissions."
        : e.error === "network" ? "Speech recognition needs a connection on this phone. Type your note instead."
        : e.error === "language-not-supported" ? "This phone can't recognise that language by voice. Type your note instead."
        : "Couldn't hear you. Try again.",
    );
  });

  const start = useCallback(async () => {
    setError(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError("Microphone permission is off. Turn it on in Android Settings > Apps > Learning Log > Permissions.");
      return;
    }
    committed.current = "";
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: codesFor(language).speech,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
    });
  }, [language]);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  return { supported: voiceSupported, listening, error, start, stop };
}
