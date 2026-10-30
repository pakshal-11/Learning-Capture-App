import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { categoriesOf, searchEntries, titleOf } from "../../src/lib/entries";
import { useStore } from "../../src/lib/store";
import { relativeDay } from "../../src/lib/time";
import type { Status } from "../../src/lib/types";
import { Chip, Empty, Input, ListRow, Row, Screen, Stack, Tag, Text } from "../../src/ui";

const STATUSES: Array<Status | "All"> = ["All", "New", "Reviewing", "Mastered"];

export default function Browse() {
  const router = useRouter();
  const entries = useStore((s) => s.entries);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "All">("All");
  const [category, setCategory] = useState<string>("All");

  const categories = useMemo(() => categoriesOf(entries), [entries]);
  const list = useMemo(() => searchEntries(entries, { query, status, category }), [entries, query, status, category]);

  return (
    <Screen tabs>
      <Stack gap={14}>
        <Text variant="title" accessibilityRole="header">Browse</Text>
        <Input value={query} onChangeText={setQuery} placeholder="Search your learnings" autoCapitalize="none" accessibilityLabel="Search" />
        <Row style={{ flexWrap: "wrap" }}>
          {STATUSES.map((s) => <Chip key={s} label={s} selected={status === s} onPress={() => setStatus(s)} />)}
        </Row>
        {categories.length > 0 ? (
          <Row style={{ flexWrap: "wrap" }}>
            {["All", ...categories].map((cat) => <Chip key={cat} label={cat === "All" ? "All topics" : cat} icon={cat === "All" ? undefined : "pricetag-outline"} selected={category === cat} onPress={() => setCategory(cat)} />)}
          </Row>
        ) : null}

        <Text variant="small" muted>{list.length} learning{list.length === 1 ? "" : "s"}</Text>
        <Stack gap={8}>
          {list.map((e) => (
            <ListRow
              key={e.id}
              title={titleOf(e)}
              subtitle={[e.category, e.status === "Mastered" ? "Mastered" : `Review ${relativeDay(e.next_review)}`].filter(Boolean).join(" · ")}
              right={e.structure_state === "raw" ? <Tag label="Not organised" tone="warn" /> : <Tag label={e.status} tone={e.status === "Mastered" ? "success" : e.status === "New" ? "primary" : "neutral"} />}
              onPress={() => router.push({ pathname: "/entry/[id]", params: { id: e.id } })}
            />
          ))}
        </Stack>
        {list.length === 0 ? <Empty icon="search-outline" title={Object.keys(entries).length ? "No matches" : "Nothing saved yet"} hint={Object.keys(entries).length ? "Try a different word or clear the filters." : "Tap + to capture your first learning."} /> : null}
      </Stack>
    </Screen>
  );
}
