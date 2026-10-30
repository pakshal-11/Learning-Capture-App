import { useRouter } from "expo-router";
import { useState } from "react";
import { googleEnabled, signInWithGoogle } from "../src/lib/googleSignIn";
import { DEV_PASSWORD_LOGIN, supabase } from "../src/lib/supabase";
import { Banner, Button, Card, Input, Row, Screen, Stack, Text } from "../src/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function friendly(message: string): string {
  if (/rate limit|too many|seconds/i.test(message)) return "Too many tries. Wait a minute, then try again.";
  if (/expired|invalid/i.test(message)) return "That code is wrong or has expired. Check it or ask for a new one.";
  if (/network|fetch/i.test(message)) return "You're offline. Connect to the internet to sign in.";
  return message;
}

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const clean = email.trim().toLowerCase();

  async function sendCode() {
    if (!EMAIL_RE.test(clean)) return setError("Enter a valid email address.");
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) return setError(friendly(e.message));
    setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: clean, token: code.trim(), type: "email" });
    setBusy(false);
    if (e) setError(friendly(e.message));
  }

  async function devLogin() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: clean, password });
    setBusy(false);
    if (e) setError(e.message);
  }

  return (
    <Screen>
      <Stack gap={24}>
        <Stack gap={8}>
          <Text variant="title">Learning Log</Text>
          <Text muted>Capture what you learn. Recall it when you need it.</Text>
        </Stack>

        <Card>
          {!sent ? (
            <Stack>
              <Input
                label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com"
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
                onSubmitEditing={sendCode}
              />
              <Text variant="small" muted>We'll email you a code. No password needed.</Text>
              {error ? <Banner tone="error">{error}</Banner> : null}
              <Button title="Send code" onPress={sendCode} loading={busy} disabled={!clean} />
            </Stack>
          ) : (
            <Stack>
              <Banner tone="success">Code sent to {clean}. Check your inbox (and spam).</Banner>
              <Input
                label="Code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ""))} placeholder="123456"
                keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={10}
                onSubmitEditing={verify}
              />
              {error ? <Banner tone="error">{error}</Banner> : null}
              <Button title="Sign in" onPress={verify} loading={busy} disabled={code.length < 6} />
              <Button title="Use a different email" variant="ghost" onPress={() => { setSent(false); setCode(""); setError(null); }} />
            </Stack>
          )}
        </Card>

        {googleEnabled ? (
          <Button
            title="Continue with Google" variant="secondary" icon="logo-google" loading={busy}
            onPress={async () => { setBusy(true); setError(null); const msg = await signInWithGoogle(); setBusy(false); if (msg) setError(msg); }}
          />
        ) : null}

        {DEV_PASSWORD_LOGIN ? (
          <Card>
            <Stack>
              <Text variant="label">Developer sign-in (local testing only)</Text>
              <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
              <Button title="Sign in with password" variant="secondary" onPress={devLogin} loading={busy} disabled={!clean || !password} />
            </Stack>
          </Card>
        ) : null}

        <Row gap={4} style={{ flexWrap: "wrap" }}>
          <Text variant="small" muted>By continuing you agree to the</Text>
          <Text variant="small" accessibilityRole="link" bold onPress={() => router.push("/privacy")}>privacy notice</Text>
        </Row>
      </Stack>
    </Screen>
  );
}
