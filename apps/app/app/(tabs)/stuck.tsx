import { useRouter } from "expo-router";
import { useState } from "react";
import { findStuck, isApiError, isUnavailable, stuckFeedback, type StuckMatch } from "../../src/lib/api";
import { useStore } from "../../src/lib/store";
import { Banner, Button, Card, Chip, Input, Row, Screen, Stack, Text } from "../../src/ui";

type Rating = "helped" | "partly" | "didnt";
interface Result {
  queryId: string;
  none: boolean;
  matches: StuckMatch[];
  message: string;
}

export default function Stuck() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [rated, setRated] = useState<Record<string, Rating>>({});
  const [thanks, setThanks] = useState<string | null>(null);
  const quota = useStore((s) => s.quota);

  async function search() {
    setBusy(true);
    setError(null);
    setResult(null);
    setRated({});
    setThanks(null);
    const r = await findStuck(problem.trim());
    setBusy(false);
    if (isUnavailable(r) || isApiError(r)) return setError(r.message);
    if (!r.ok) return;
    useStore.getState().setQuota(r.quota);
    setResult({ queryId: r.query_id, none: r.none_relevant, matches: r.matches, message: r.message });
  }

  async function rate(m: StuckMatch, rating: Rating) {
    if (!result) return;
    setRated((x) => ({ ...x, [m.entry_id]: rating }));
    const r = await stuckFeedback({ query_id: result.queryId, entry_id: m.entry_id, rating });
    if (isApiError(r)) {
      setRated((x) => { const { [m.entry_id]: _, ...rest } = x; return rest; });
      return setError(r.message);
    }
    if (r.ok && r.reinforced && r.review) {
      useStore.getState().applyServerReview(r.review);
      setThanks("Glad it helped. That counts as a review of this note.");
    } else if (rating === "helped") setThanks("Glad it helped.");
  }

  return (
    <Screen tabs>
      <Stack gap={16}>
        <Stack gap={4}>
          <Text variant="title" accessibilityRole="header">I'm stuck</Text>
          <Text muted>Describe the problem. We'll look through what you've already learned.</Text>
        </Stack>

        <Input
          value={problem} onChangeText={setProblem} multiline maxLength={1000}
          placeholder="e.g. My report query is slow and sorts a lot of rows"
          hint="Tip: tap the microphone on your keyboard to speak."
          accessibilityLabel="Describe your problem"
        />
        <Button title="Find help in my notes" icon="search" onPress={search} loading={busy} disabled={problem.trim().length < 3} />
        {quota ? <Text variant="small" muted>AI help used today: {quota.used} of {quota.limit}</Text> : null}

        {error ? <Banner tone="warn">{error}</Banner> : null}
        {thanks ? <Banner tone="success">{thanks}</Banner> : null}

        {result?.none ? (
          <Card>
            <Text variant="h2">Nothing relevant found</Text>
            <Text muted>{result.message}</Text>
            <Button title="Capture what you learn" variant="secondary" onPress={() => router.push("/capture")} />
          </Card>
        ) : null}

        {result && !result.none ? (
          <Stack gap={12}>
            <Text variant="h2">From your notes</Text>
            {result.matches.map((m) => (
              <Card key={m.entry_id}>
                <Text bold onPress={() => router.push({ pathname: "/entry/[id]", params: { id: m.entry_id } })}>{m.topic ?? "Note"}</Text>
                {m.key_idea ? <Text variant="small" muted>{m.key_idea}</Text> : null}
                <Text variant="label">Why it applies</Text>
                <Text>{m.why}</Text>
                <Text variant="label">How to use it</Text>
                <Text>{m.how_to_use}</Text>
                <Text variant="label">Did this help?</Text>
                <Row style={{ flexWrap: "wrap" }}>
                  <Chip label="Helped" icon="thumbs-up-outline" selected={rated[m.entry_id] === "helped"} onPress={() => void rate(m, "helped")} />
                  <Chip label="Partly" selected={rated[m.entry_id] === "partly"} onPress={() => void rate(m, "partly")} />
                  <Chip label="Didn't help" icon="thumbs-down-outline" selected={rated[m.entry_id] === "didnt"} onPress={() => void rate(m, "didnt")} />
                </Row>
              </Card>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Screen>
  );
}
