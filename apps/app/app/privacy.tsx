import { useRouter } from "expo-router";
import { PRIVACY_SECTIONS, PRIVACY_SUMMARY } from "../src/content/privacy";
import { Button, Card, Screen, Stack, Text } from "../src/ui";

export default function Privacy() {
  const router = useRouter();
  return (
    <Screen footer={<Button title="Close" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />}>
      <Stack gap={16}>
        <Text variant="title" accessibilityRole="header">Privacy notice</Text>
        <Card tone="primary">
          <Text variant="h2">In short</Text>
          {PRIVACY_SUMMARY.map((p) => <Text key={p}>• {p}</Text>)}
        </Card>
        {PRIVACY_SECTIONS.map((s) => (
          <Stack key={s.title} gap={6}>
            <Text variant="h2">{s.title}</Text>
            {s.points.map((p) => <Text key={p} muted>• {p}</Text>)}
          </Stack>
        ))}
        <Text variant="small" muted>Test build draft, version 2026-10-30.</Text>
      </Stack>
    </Screen>
  );
}
