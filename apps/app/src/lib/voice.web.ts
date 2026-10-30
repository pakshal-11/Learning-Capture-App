// Web/PWA/desktop: no in-app microphone. Browsers' built-in speech recognition sends audio to a cloud service, which this
// build avoids; people dictate with their keyboard's mic (phones) or Win+H (Windows) instead.
export const voiceSupported = false;

export function useVoice(_language: string, _onText: (committed: string, partial: string) => void) {
  return { supported: false, listening: false, error: null as string | null, start: async () => {}, stop: () => {} };
}
