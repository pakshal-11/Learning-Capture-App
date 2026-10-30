// Android/iOS: Google ML Kit text recognition, runs fully on the device.
import TextRecognition, { TextRecognitionScript } from "@react-native-ml-kit/text-recognition";
import { codesFor } from "./languages";

export const ocrNote = "Reads English and Hindi/Marathi on this phone. For other languages, type or dictate instead.";

export async function recognizeText(uri: string, language: string): Promise<string> {
  const script = codesFor(language).devanagari ? TextRecognitionScript.DEVANAGARI : TextRecognitionScript.LATIN;
  const result = await TextRecognition.recognize(uri, script);
  return result.text.trim();
}
