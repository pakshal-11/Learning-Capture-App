// Maps the language a user picked in onboarding to what speech recognition and OCR engines expect.
interface Codes {
  speech: string; // BCP-47 for the Android speech recogniser
  tess: string; // tesseract.js language code
  devanagari: boolean; // ML Kit on Android reads Latin and Devanagari only
}

const MAP: Record<string, Codes> = {
  english: { speech: "en-IN", tess: "eng", devanagari: false },
  hindi: { speech: "hi-IN", tess: "hin", devanagari: true },
  marathi: { speech: "mr-IN", tess: "mar", devanagari: true },
  gujarati: { speech: "gu-IN", tess: "guj", devanagari: false },
  tamil: { speech: "ta-IN", tess: "tam", devanagari: false },
  telugu: { speech: "te-IN", tess: "tel", devanagari: false },
  bengali: { speech: "bn-IN", tess: "ben", devanagari: false },
  kannada: { speech: "kn-IN", tess: "kan", devanagari: false },
  malayalam: { speech: "ml-IN", tess: "mal", devanagari: false },
  punjabi: { speech: "pa-IN", tess: "pan", devanagari: false },
};

export const codesFor = (language: string | null | undefined): Codes =>
  MAP[(language ?? "").trim().toLowerCase()] ?? MAP.english!;
