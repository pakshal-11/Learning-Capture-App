import { localDate, visibleStreak } from "@learning-log/core";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import { dueEntries, dueToday, endOfLocalDay, titleOf, visibleEntries } from "../../src/lib/entries";
import { useStore } from "../../src/lib/store";
import { relativeDay } from "../../src/lib/time";
import { useTheme } from "../../src/theme";
import { Banner, Button, Card, Empty, ListRow, Row, Screen, Stack, Tag, Text } from "../../src/ui";
import { SyncLine } from "../../src/ui/SyncLine";

export default function Home() {
  const router = useRouter();
  const c = useTheme();
  const entries = useStore((s) => s.entries);
  const profile = useStore((s) => s.profile);

  const now = new Date();
  const all = useMemo(() => visibleEntries(entries), [entries]);
  const due = dueEntries(entries, now);
  const today = dueToday(entries, endOfLocalDay(now));
  const raw = all.filter((e) => e.structure_state === "raw");
  const recent = [...all].sort((a, b) => Date.parse(b.learned_at) - Date.parse(a.learned_at)).slice(0, 5);
  const streak = profile
    ? visibleStreak({ current: profile.streak_current, best: profile.streak_best, lastDate: profile.last_review_date }, localDate(now, profile.timezone))
    : 0;

  return (
    <Screen tabs>
      <Stack gap={16}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="title" accessibilityRole="header">Today</Text>
          <Row gap={6}>
            <Ionicons name="flame" size={22} color={streak > 0 ? "#F97316" : c.muted} />
            <Text bold accessibilityRole="text">{streak} day{streak === 1 ? "" : "s"}</Text>
          </Row>
        </Row>
        <SyncLine />

        <Card tone="primary">
          {due.length > 0 ? (
            <>
              <Text variant="h2">{due.length} to review now</Text>
              <Text muted>{today.length > due.length ? `${today.length} due by tonight.` : "Short and sweet: one question at a time."}</Text>
              <Button title="Start review" icon="play" onPress={() => router.push("/review")} />
            </>
          ) : (
            <>
              <Text variant="h2">{all.length === 0 ? "Nothing here yet" : "All caught up"}</Text>
              <Text muted>{all.length === 0 ? "Capture something you just learned. It takes seconds." : today.length ? `${today.length} due later today.` : "No reviews due. Capture something new?"}</Text>
              <Button title="Capture a learning" icon="add" onPress={() => router.push("/capture")} />
            </>
          )}
        </Card>

        <Button title="I'm stuck on something" icon="help-buoy-outline" variant="secondary" onPress={() => router.push("/stuck")} />

        {raw.length > 0 ? (
          <Banner tone="info" action={{ label: "Structure now", onPress: () => router.push({ pathname: "/preview/[id]", params: { id: raw[0]!.id } }) }}>
            {raw.length} note{raw.length === 1 ? " is" : "s are"} saved but not organised yet.
          </Banner>
        ) : null}

        {recent.length > 0 ? (
          <Stack gap={8}>
            <Text variant="h2">Recent</Text>
            {recent.map((e) => (
              <ListRow
                key={e.id}
                title={titleOf(e)}
                subtitle={e.status === "Mastered" ? "Mastered" : `Next review ${relativeDay(e.next_review)}`}
                right={e.structure_state === "raw" ? <Tag label="Not organised" tone="warn" /> : <Tag label={e.status} tone={e.status === "Mastered" ? "success" : e.status === "New" ? "primary" : "neutral"} />}
                onPress={() => router.push({ pathname: "/entry/[id]", params: { id: e.id } })}
              />
            ))}
          </Stack>
        ) : <View />}
        {all.length === 0 ? <Empty icon="bulb-outline" title="Your learning log starts here" hint="Tap the + button any time to capture a note." /> : null}
      </Stack>
    </Screen>
  );
}
