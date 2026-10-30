// Web/PWA/desktop: tesseract.js (WebAssembly) reads the image inside the browser. The image never leaves the device;
// only the language model file is downloaded the first time.
import { codesFor } from "./languages";

export const ocrNote = "The picture is read on your device. The first time, a language file (a few MB) downloads.";

export async function recognizeText(uri: string, language: string): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const code = codesFor(language).tess;
  const worker = await createWorker(code === "eng" ? "eng" : ["eng", code]);
  try {
    const { data } = await worker.recognize(uri);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}
