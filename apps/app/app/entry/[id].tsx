import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Linking } from "react-native";
import { addToCalendar } from "../../src/lib/calendar";
import { useStore } from "../../src/lib/store";
import { relativeDay } from "../../src/lib/time";
import { Banner, Button, Card, Row, Screen, Stack, Tag, Text } from "../../src/ui";
import { titleOf } from "../../src/lib/entries";

export default function EntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const entry = useStore((s) => s.entries[id]);
  const [confirm, setConfirm] = useState(false);
  const [calMsg, setCalMsg] = useState<string | null>(null);

  if (!entry || entry.deleted_at) {
    return <Screen><Text variant="h2">Note not found</Text><Button title="Back" onPress={() => router.replace("/")} /></Screen>;
  }
  const raw = entry.structure_state === "raw";

  return (
    <Screen>
      <Stack gap={16}>
        <Text bold accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}>‹ Back</Text>
        <Text variant="title" accessibilityRole="header">{titleOf(entry)}</Text>
        <Row style={{ flexWrap: "wrap" }}>
          <Tag label={entry.status} tone={entry.status === "Mastered" ? "success" : entry.status === "New" ? "primary" : "neutral"} />
          {entry.category ? <Tag label={entry.category} /> : null}
          {raw ? <Tag label="Not organised" tone="warn" /> : null}
        </Row>

        {raw ? (
          <Banner tone="info" action={{ label: "Organise with AI", onPress: () => router.push({ pathname: "/preview/[id]", params: { id: entry.id } }) }}>
            This note is saved as you wrote it.
          </Banner>
        ) : null}

        {entry.key_idea ? <Card><Text variant="label">Key idea</Text><Text selectable>{entry.key_idea}</Text></Card> : null}
        {entry.recall_question ? <Card><Text variant="label">Recall question</Text><Text selectable>{entry.recall_question}</Text></Card> : null}
        {entry.apply_it ? <Card><Text variant="label">Apply it</Text><Text selectable>{entry.apply_it}</Text></Card> : null}
        <Card>
          <Text variant="label">Your original note</Text>
          <Text selectable>{entry.raw_text || "(link only)"}</Text>
          {entry.source_url ? <Text accessibilityRole="link" bold onPress={() => void Linking.openURL(entry.source_url!)}>{entry.source_url}</Text> : null}
        </Card>

        <Card>
          <Text variant="label">Review</Text>
          <Text>Next review: {entry.status === "Mastered" ? "none (mastered)" : relativeDay(entry.next_review)}</Text>
          <Text muted>Reviewed {entry.times_reviewed} time{entry.times_reviewed === 1 ? "" : "s"}{entry.last_result ? ` · last: ${entry.last_result}` : ""}</Text>
          <Text muted>Correct in a row: {entry.streak_correct} of 5</Text>
        </Card>

        <Button title="Review now" icon="play" onPress={() => router.push({ pathname: "/review", params: { entry: entry.id } })} disabled={raw} />
        {entry.next_review && entry.status !== "Mastered" ? (
          <Button
            title="Add next review to calendar" variant="secondary" icon="calendar-outline"
            onPress={async () => {
              const r = await addToCalendar({
                id: entry.id, title: titleOf(entry), due: new Date(entry.next_review!),
                time: useStore.getState().profile?.reminder_times[0] ?? null,
                note: entry.recall_question ?? undefined,
              });
              setCalMsg(r.ok ? null : r.message ?? "Couldn't add it.");
            }}
          />
        ) : null}
        {calMsg ? <Banner tone="error">{calMsg}</Banner> : null}
        {!raw ? <Button title="Edit" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: "/preview/[id]", params: { id: entry.id, edit: "1" } })} /> : null}
        {!confirm
          ? <Button title="Delete" variant="ghost" onPress={() => setConfirm(true)} />
          : (
            <Card>
              <Text bold>Delete this note?</Text>
              <Text muted>It's removed from all your devices.</Text>
              <Button title="Yes, delete" variant="danger" onPress={() => { useStore.getState().removeEntry(entry.id); router.replace("/"); }} />
              <Button title="Keep it" variant="secondary" onPress={() => setConfirm(false)} />
            </Card>
          )}
      </Stack>
    </Screen>
  );
}
