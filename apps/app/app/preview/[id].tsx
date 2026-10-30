// Preview / edit: AI organises a raw note into Topic, Key idea, Recall question, Apply it, Category.
// The user always reviews and edits before it is saved. Also used to edit an already-organised note (?edit=1).
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { isApiError, isUnavailable, structureNote } from "../../src/lib/api";
import { useStore } from "../../src/lib/store";
import { Banner, Button, Card, Input, Loading, Screen, Stack, Text } from "../../src/ui";

export default function Preview() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const router = useRouter();
  const entry = useStore((s) => s.entries[id]);
  const language = useStore((s) => s.profile?.language ?? null);

  const alreadyDone = entry?.structure_state === "structured";
  const [topic, setTopic] = useState(entry?.topic ?? "");
  const [keyIdea, setKeyIdea] = useState(entry?.key_idea ?? "");
  const [question, setQuestion] = useState(entry?.recall_question ?? "");
  const [applyIt, setApplyIt] = useState(entry?.apply_it ?? "");
  const [category, setCategory] = useState(entry?.category ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const started = useRef(false);

  async function organise() {
    if (!entry) return;
    setBusy(true);
    setNotice(null);
    const r = await structureNote(entry.raw_text);
    setBusy(false);
    if (isUnavailable(r) || isApiError(r)) {
      setTopic((t) => t || entry.raw_text.split("\n")[0]!.slice(0, 60));
      return setNotice({ tone: "warn", text: `${r.message} You can fill the fields yourself and save.` });
    }
    if (!r.ok) return;
    useStore.getState().setQuota(r.quota);
    setTopic(r.note.topic);
    setKeyIdea(r.note.key_idea);
    setQuestion(r.note.recall_question);
    setApplyIt(r.note.apply_it);
    setCategory(r.note.category);
    setNotice({ tone: "info", text: "Check and edit anything before saving." });
  }

  useEffect(() => {
    if (started.current || !entry || alreadyDone || edit === "1") return;
    started.current = true;
    if (entry.raw_text.trim().length >= 3) void organise();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  if (!entry) return <Screen><Text>This note was not found.</Text><Button title="Back" onPress={() => router.back()} /></Screen>;

  const canSave = topic.trim() && keyIdea.trim();

  function save() {
    useStore.getState().patchEntry(entry!.id, {
      topic: topic.trim(),
      key_idea: keyIdea.trim(),
      recall_question: question.trim() || null,
      apply_it: applyIt.trim() || null,
      category: category.trim() || null,
      structure_state: "structured",
      language: entry!.language ?? language,
    });
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <Screen
      footer={
        <Stack gap={8}>
          <Button title="Save" icon="checkmark" onPress={save} disabled={!canSave || busy} />
          <Button title={alreadyDone || edit === "1" ? "Cancel" : "Keep it as a raw note"} variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        </Stack>
      }
    >
      <Stack gap={16}>
        <Text variant="title" accessibilityRole="header">{alreadyDone || edit === "1" ? "Edit learning" : "Review and edit"}</Text>
        <Card><Text variant="label">Your note</Text><Text selectable>{entry.raw_text || entry.source_url}</Text></Card>

        {busy ? <Loading label="Organising your note…" /> : null}
        {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}

        <Input label="Topic" value={topic} onChangeText={setTopic} maxLength={120} />
        <Input label="Key idea" value={keyIdea} onChangeText={setKeyIdea} multiline maxLength={600} style={{ minHeight: 90 }} />
        <Input label="Recall question" value={question} onChangeText={setQuestion} multiline maxLength={400} style={{ minHeight: 80 }} hint="You'll be asked this when it's time to review." />
        <Input label="Apply it" value={applyIt} onChangeText={setApplyIt} multiline maxLength={600} style={{ minHeight: 80 }} />
        <Input label="Category" value={category} onChangeText={setCategory} maxLength={60} />

        {entry.raw_text.trim().length >= 3 ? <Button title="Organise again with AI" variant="ghost" icon="refresh" onPress={organise} loading={busy} /> : null}
      </Stack>
    </Screen>
  );
}
