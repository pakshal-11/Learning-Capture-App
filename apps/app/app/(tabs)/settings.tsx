import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Share } from "react-native";
import { deleteAccount, exportData } from "../../src/lib/api";
import { bubbleAvailable, canDrawOverlays, isBubbleRunning, openOverlaySettings, startBubble, stopBubble } from "../../modules/floating-bubble/src";
import { disablePush, enablePush, getPushStatus, type PushStatus } from "../../src/lib/push";
import { useStore, type ThemePref } from "../../src/lib/store";
import { supabase } from "../../src/lib/supabase";
import { syncAll } from "../../src/lib/sync";
import { fmtTime } from "../../src/lib/time";
import { Banner, Button, Card, Chip, Input, Row, Screen, Stack, Text } from "../../src/ui";
import { SyncLine } from "../../src/ui/SyncLine";

const PUSH_TEXT: Record<PushStatus, string> = {
  on: "Notifications are on for this device.",
  off: "Notifications are off for this device.",
  denied: "Notifications are blocked for this device.",
  "needs-install": "To get reminders on iPhone, add Learning Log to your Home Screen first.",
  unsupported: "This device can't show reminders. Open the Android app or add the web app to your Home Screen.",
  "not-configured": "Notifications aren't set up in this build yet.",
};

const THEMES: Array<[ThemePref, string]> = [["system", "Match device"], ["light", "Light"], ["dark", "Dark"]];

async function saveExport(text: string): Promise<void> {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "learning-log-export.json";
    a.click();
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ message: text, title: "Learning Log export" });
  }
}

export default function Settings() {
  const router = useRouter();
  const profile = useStore((s) => s.profile);
  const theme = useStore((s) => s.theme);
  const quota = useStore((s) => s.quota);
  const pending = useStore((s) => s.outbox.length);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const [push, setPush] = useState<PushStatus>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  useEffect(() => { void getPushStatus().then(setPush); }, []);

  async function turnOnPush() {
    setPushBusy(true);
    setPushMsg(null);
    const r = await enablePush();
    if (!r.ok) setPushMsg(r.message ?? "Couldn't turn on notifications.");
    setPush(await getPushStatus());
    setPushBusy(false);
  }

  async function turnOffPush() {
    setPushBusy(true);
    await disablePush();
    setPush(await getPushStatus());
    setPushBusy(false);
  }

  const [bubbleOn, setBubbleOn] = useState(isBubbleRunning());
  const [bubbleMsg, setBubbleMsg] = useState<string | null>(null);

  function turnOnBubble() {
    if (!canDrawOverlays()) {
      setBubbleMsg("Android is opening a settings page. Find Learning Log, switch on \"Allow display over other apps\", then come back here and tap the button again.");
      openOverlaySettings();
      return;
    }
    setBubbleMsg(null);
    setBubbleOn(startBubble());
  }

  async function doExport() {
    setBusy("export");
    setMsg(null);
    await syncAll();
    const r = await exportData();
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "error", text: r.message });
    await saveExport(r.text);
    setMsg({ tone: "success", text: "Your data was exported." });
  }

  async function doDelete() {
    setBusy("delete");
    const r = await deleteAccount();
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "error", text: r.message });
    await supabase.auth.signOut();
  }

  async function signOut() {
    if (pending > 0) await syncAll();
    if (useStore.getState().outbox.length > 0) {
      return setMsg({ tone: "warn", text: `${useStore.getState().outbox.length} change(s) haven't synced yet. Connect to the internet and try again, or you'll lose them.` });
    }
    await supabase.auth.signOut();
  }

  return (
    <Screen tabs>
      <Stack gap={18}>
        <Text variant="title" accessibilityRole="header">Settings</Text>
        {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}

        <Card>
          <Text variant="label">Profile</Text>
          <Text bold>{profile?.role_type === "student" ? `Student · ${profile.field_of_study ?? ""}${profile.year ? ` · ${profile.year}` : ""}` : `${profile?.profession ?? ""}${profile?.experience_level ? ` · ${profile.experience_level}` : ""}`}</Text>
          <Text muted>Language: {profile?.language}</Text>
          <Text muted>Goals: {(profile?.goals ?? []).join(", ") || "none"}</Text>
          <Button title="Edit profile" variant="secondary" onPress={() => router.push({ pathname: "/onboarding", params: { edit: "1" } })} />
        </Card>

        <Card>
          <Text variant="label">Reminders</Text>
          <Text>{profile?.reminder_times.length ? profile.reminder_times.map(fmtTime).join(", ") : "No reminder times set"}</Text>
          <Text variant="small" muted>Time zone: {profile?.timezone}.</Text>
          <Text bold>{PUSH_TEXT[push]}</Text>
          {pushMsg ? <Banner tone="warn">{pushMsg}</Banner> : null}
          {push === "off" || push === "denied" || push === "needs-install" ? (
            <Button title="Turn on notifications" onPress={turnOnPush} loading={pushBusy} />
          ) : null}
          {push === "on" ? <Button title="Turn off notifications" variant="ghost" onPress={turnOffPush} loading={pushBusy} /> : null}
          <Button title="Change times" variant="secondary" onPress={() => router.push({ pathname: "/onboarding", params: { edit: "1" } })} />
        </Card>

        {bubbleAvailable ? (
          <Card>
            <Text variant="label">Quick capture button</Text>
            <Text>A small + button that floats over other apps. Tap it to jot down a note without leaving what you're doing.</Text>
            <Text variant="small" muted>Android will ask you to allow "Display over other apps". The button only opens Learning Log. It never reads your screen or other apps.</Text>
            {bubbleMsg ? <Banner tone="info">{bubbleMsg}</Banner> : null}
            {bubbleOn ? (
              <Button title="Turn off the button" variant="secondary" onPress={() => { stopBubble(); setBubbleOn(false); }} />
            ) : (
              <Button title="Turn on the button" onPress={turnOnBubble} />
            )}
          </Card>
        ) : null}

        <Card>
          <Text variant="label">Appearance</Text>
          <Row style={{ flexWrap: "wrap" }}>
            {THEMES.map(([v, label]) => <Chip key={v} label={label} selected={theme === v} onPress={() => useStore.getState().setTheme(v)} />)}
          </Row>
        </Card>

        <Card>
          <Text variant="label">Sync</Text>
          <SyncLine />
          <Button title="Sync now" variant="secondary" onPress={() => void syncAll()} />
          {quota ? <Text variant="small" muted>AI help used today: {quota.used} of {quota.limit}</Text> : null}
        </Card>

        <Card>
          <Text variant="label">Your data</Text>
          <Button title="Privacy notice" variant="secondary" onPress={() => router.push("/privacy")} />
          <Button title="Export my data" variant="secondary" onPress={doExport} loading={busy === "export"} />
          {!confirming ? (
            <Button title="Delete my account" variant="ghost" onPress={() => setConfirming(true)} />
          ) : (
            <Stack>
              <Banner tone="error">This permanently deletes your account and all your notes. It can't be undone. Type DELETE to confirm.</Banner>
              <Input value={typed} onChangeText={setTyped} autoCapitalize="characters" placeholder="DELETE" />
              <Button title="Delete everything" variant="danger" onPress={doDelete} loading={busy === "delete"} disabled={typed !== "DELETE"} />
              <Button title="Cancel" variant="secondary" onPress={() => { setConfirming(false); setTyped(""); }} />
            </Stack>
          )}
        </Card>

        {profile?.is_admin ? <Button title="Admin: usage and cost" variant="secondary" icon="stats-chart" onPress={() => router.push("/admin")} /> : null}
        <Button title="Sign out" variant="secondary" icon="log-out-outline" onPress={signOut} />
        <Text variant="small" muted center>Learning Log {Constants.expoConfig?.version ?? ""} · test build</Text>
      </Stack>
    </Screen>
  );
}
