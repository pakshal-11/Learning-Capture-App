// Review: question -> typed answer -> AI grades (Correct / Partly / Missed) -> feedback -> schedule updates.
// Offline, or when AI is unavailable, the user can reveal the answer and grade themselves; it syncs later.
import { localDate, visibleStreak } from "@learning-log/core";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { gradeAnswer } from "../src/lib/api";
import { currentQuestion, dueEntries } from "../src/lib/entries";
import { useStore } from "../src/lib/store";
import { relativeDay } from "../src/lib/time";
import type { Grade } from "../src/lib/types";
import { Banner, Button, Card, Empty, Input, Row, Screen, Stack, Tag, Text } from "../src/ui";

interface Result {
  grade: Grade;
  source: "ai" | "self";
  feedback?: string;
  correct?: string;
}

export default function Review() {
  const { entry: only } = useLocalSearchParams<{ entry?: string }>();
  const router = useRouter();
  // the queue is fixed when the session starts, so new sync data never reshuffles it mid-session
  const [queue] = useState<string[]>(() => (only ? [only] : dueEntries(useStore.getState().entries, new Date()).map((e) => e.id)));
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"question" | "selfgrade" | "result">("question");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<Grade, number>>({ Correct: 0, Partly: 0, Missed: 0 });
  const attempt = useRef(randomUUID());
  const asked = useRef<{ idx: number; text: string } | null>(null);

  const entry = useStore((s) => (queue[idx] ? s.entries[queue[idx]!] : undefined));
  const profile = useStore((s) => s.profile);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const removed = !!queue[idx] && (!entry || !!entry.deleted_at);
  useEffect(() => {
    if (removed) setIdx((i) => i + 1);
  }, [removed, idx]);

  if (queue.length === 0) {
    return (
      <Screen footer={<Button title="Back home" onPress={close} />}>
        <Empty icon="checkmark-done-outline" title="Nothing due" hint="Come back later, or capture something new." />
      </Screen>
    );
  }

  if (idx >= queue.length) {
    const total = tally.Correct + tally.Partly + tally.Missed;
    const streak = profile ? visibleStreak({ current: profile.streak_current, best: profile.streak_best, lastDate: profile.last_review_date }, localDate(new Date(), profile.timezone)) : 0;
    return (
      <Screen footer={<Button title="Done" onPress={close} />}>
        <Stack gap={16}>
          <Text variant="title" accessibilityRole="header">Session complete</Text>
          <Card tone="primary">
            <Text variant="h2">{total} reviewed</Text>
            <Row style={{ flexWrap: "wrap" }}>
              <Tag label={`${tally.Correct} Correct`} tone="success" />
              <Tag label={`${tally.Partly} Partly`} tone="warn" />
              <Tag label={`${tally.Missed} Missed`} tone="danger" />
            </Row>
            <Text bold>🔥 {streak} day streak</Text>
          </Card>
          {tally.Missed > 0 ? <Text muted>Missed ones come back tomorrow, so you'll lock them in.</Text> : <Text muted>Nice work. See you at the next reminder.</Text>}
        </Stack>
      </Screen>
    );
  }

  if (!entry || entry.deleted_at) {
    // deleted on another device mid-session: the effect above skips it
    return <Screen><Text muted>Skipping a removed note…</Text></Screen>;
  }

  // Freeze the question asked: grading stores a new variant on the entry, which must not replace it on screen.
  if (asked.current?.idx !== idx) asked.current = { idx, text: currentQuestion(entry) };
  const question = asked.current.text;

  function record(r: Result) {
    setResult(r);
    setTally((t) => ({ ...t, [r.grade]: t[r.grade] + 1 }));
    setPhase("result");
  }

  async function check() {
    setBusy(true);
    setNote(null);
    const r = await gradeAnswer({ entry_id: entry!.id, review_id: attempt.current, question, answer: answer.trim() });
    setBusy(false);
    if (r.ok) {
      useStore.getState().applyServerReview(r.review);
      useStore.getState().setQuota(r.quota);
      return record({ grade: r.grade, source: "ai", feedback: r.feedback, correct: r.correct_answer });
    }
    setNote(`${r.message} You can check the answer and grade yourself.`);
    setPhase("selfgrade");
  }

  function selfGrade(grade: Grade) {
    useStore.getState().recordSelfReview(entry!.id, grade, question, answer.trim() || undefined);
    record({ grade, source: "self" });
  }

  function next() {
    attempt.current = randomUUID();
    setAnswer("");
    setResult(null);
    setNote(null);
    setPhase("question");
    setIdx((i) => i + 1);
  }

  const reveal = entry.key_idea ?? entry.raw_text;

  return (
    <Screen>
      <Stack gap={16}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="small" muted>Question {idx + 1} of {queue.length}</Text>
          <Text bold accessibilityRole="link" onPress={close}>End session</Text>
        </Row>

        <Card tone="primary">
          <Text variant="label">{entry.topic ?? "Recall"}</Text>
          <Text variant="h2" accessibilityRole="header">{question}</Text>
        </Card>

        {phase === "question" ? (
          <Stack>
            <Input value={answer} onChangeText={setAnswer} multiline maxLength={2000} placeholder="Type your answer from memory" accessibilityLabel="Your answer" autoFocus />
            <Button title="Check my answer" icon="sparkles" onPress={check} loading={busy} disabled={!answer.trim()} />
            <Button title="Show answer and grade myself" variant="secondary" onPress={() => setPhase("selfgrade")} disabled={busy} />
          </Stack>
        ) : null}

        {phase === "selfgrade" ? (
          <Stack>
            {note ? <Banner tone="warn">{note}</Banner> : null}
            {answer.trim() ? <Card><Text variant="label">Your answer</Text><Text>{answer}</Text></Card> : null}
            <Card><Text variant="label">From your note</Text><Text selectable>{reveal}</Text>{entry.apply_it ? <Text muted>Apply it: {entry.apply_it}</Text> : null}</Card>
            <Text variant="label">How did you do?</Text>
            <Button title="Correct" variant="success" onPress={() => selfGrade("Correct")} />
            <Button title="Partly" variant="secondary" onPress={() => selfGrade("Partly")} />
            <Button title="Missed" variant="danger" onPress={() => selfGrade("Missed")} />
          </Stack>
        ) : null}

        {phase === "result" && result ? (
          <Stack>
            <Banner tone={result.grade === "Correct" ? "success" : result.grade === "Partly" ? "warn" : "error"}>
              {result.grade === "Correct" ? "Correct!" : result.grade === "Partly" ? "Partly right." : "Missed this one."}
              {result.source === "self" ? " (graded by you)" : ""}
            </Banner>
            {result.feedback ? <Card><Text variant="label">Feedback</Text><Text>{result.feedback}</Text></Card> : null}
            {result.correct ? <Card><Text variant="label">Correct answer</Text><Text selectable>{result.correct}</Text></Card> : null}
            <Text muted>
              {entry.status === "Mastered" ? "Mastered. This note won't come up in reviews any more." : `Next review ${relativeDay(entry.next_review)}.`}
            </Text>
            <Button title={idx + 1 < queue.length ? "Next question" : "Finish"} onPress={next} />
          </Stack>
        ) : null}
      </Stack>
    </Screen>
  );
}
