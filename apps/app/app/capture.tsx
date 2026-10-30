import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { ocrNote, recognizeText } from "../src/lib/ocr";
import { useStore } from "../src/lib/store";
import type { SourceType } from "../src/lib/types";
import { useVoice } from "../src/lib/voice";
import { Banner, Button, Chip, Input, Row, Screen, Stack, Text } from "../src/ui";

const isUrl = (t: string) => /^https?:\/\/\S+$/i.test(t.trim());
const join = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");

export default function Capture() {
  const router = useRouter();
  // `text`/`url` arrive from share targets (Android share sheet, PWA share) and the desktop quick-capture window.
  const params = useLocalSearchParams<{ title?: string; text?: string; url?: string; image?: string }>();
  const language = useStore((s) => s.profile?.language ?? "English");
  const [text, setText] = useState(join(params.title ?? "", params.text ?? ""));
  const [link, setLink] = useState(params.url ?? "");
  const [withLink, setWithLink] = useState(!!params.url);
  const [source, setSource] = useState<SourceType>("text");
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ tone: "info" | "warn" | "error"; text: string } | null>(null);

  const base = useRef("");
  const voice = useVoice(language, (committed, partial) => setText(join(base.current, committed, partial)));

  const justLink = isUrl(text);
  const raw = justLink ? "" : text.trim();
  const url = justLink ? text.trim() : withLink ? link.trim() : "";
  const canSave = raw.length > 0 || url.length > 0;
  const canStructure = raw.length >= 3;

  function save(organise: boolean) {
    if (voice.listening) voice.stop();
    const entry = useStore.getState().createEntry({ raw_text: raw, source_url: url || null, source_type: justLink ? "url" : source });
    if (organise) router.replace({ pathname: "/preview/[id]", params: { id: entry.id } });
    else router.back();
  }

  async function toggleVoice() {
    if (voice.listening) return voice.stop();
    base.current = text;
    setSource("voice");
    await voice.start();
  }

  async function fromScreenshot() {
    setNote(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const uri = picked.assets?.[0]?.uri;
    if (picked.canceled || !uri) return;
    await readImage(uri);
  }

  // A picture shared from another app arrives as ?image=<path>: read it straight away.
  const autoRead = useRef(false);
  useEffect(() => {
    if (params.image && !autoRead.current) {
      autoRead.current = true;
      void readImage(params.image);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  async function readImage(uri: string) {
    setReading(true);
    try {
      const found = await recognizeText(uri, language);
      if (!found) {
        setNote({ tone: "warn", text: "No text found in that picture. Try a sharper, closer screenshot, or type it." });
      } else {
        setText((t) => join(t, found).slice(0, 4000));
        setSource("screenshot");
        setNote({ tone: "info", text: "Text read from your picture. Check it and fix any mistakes before saving." });
      }
    } catch (e) {
      setNote({ tone: "error", text: "Couldn't read that picture on this device. You can type the note instead." });
      if (__DEV__) console.warn("OCR failed", e);
    } finally {
      setReading(false);
    }
  }

  return (
    <Screen
      footer={
        <Stack gap={8}>
          <Button title="Save and organise with AI" icon="sparkles" onPress={() => save(true)} disabled={!canStructure} />
          <Button title="Save for later" variant="secondary" onPress={() => save(false)} disabled={!canSave} />
        </Stack>
      }
    >
      <Stack gap={16}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="title" accessibilityRole="header">Capture</Text>
          <Text bold accessibilityRole="link" onPress={() => router.back()}>Close</Text>
        </Row>

        <Input
          value={text} onChangeText={(t) => { setText(t); if (source !== "text" && !t.trim()) setSource("text"); }}
          multiline autoFocus={!params.text && !params.title} maxLength={4000}
          placeholder="What did you just learn? Type, paste, speak or add a screenshot."
          accessibilityLabel="What did you learn"
          hint={Platform.OS === "web" ? "Tip: use your keyboard's microphone to dictate (on Windows press Win+H)." : undefined}
        />

        <Row style={{ flexWrap: "wrap" }}>
          {voice.supported ? (
            <Chip label={voice.listening ? "Stop listening" : "Speak"} icon={voice.listening ? "stop-circle-outline" : "mic-outline"} selected={voice.listening} onPress={toggleVoice} />
          ) : null}
          <Chip label={reading ? "Reading…" : "From a screenshot"} icon="image-outline" onPress={reading ? () => {} : fromScreenshot} />
          <Chip label="Add a link" icon="link-outline" selected={withLink} onPress={() => setWithLink(!withLink)} />
        </Row>
        {withLink ? <Input label="Link" value={link} onChangeText={setLink} placeholder="https://…" autoCapitalize="none" keyboardType="url" /> : null}

        {voice.listening ? <Banner tone="info">Listening… speak your note, then tap Stop listening.</Banner> : null}
        {voice.error ? <Banner tone="error">{voice.error}</Banner> : null}
        {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
        {justLink ? <Banner tone="info">Link saved as a reference. Add a few words about why it matters if you want AI to organise it.</Banner> : null}
        <Text variant="small" muted>{ocrNote}</Text>
      </Stack>
    </Screen>
  );
}
