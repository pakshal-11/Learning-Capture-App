import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useNotificationTaps } from "../src/lib/push";
import { ShareReceiver } from "../src/lib/ShareReceiver";
import { isOnboarded, useSession } from "../src/lib/session";
import { useStore } from "../src/lib/store";
import { startSyncLoop, syncAll } from "../src/lib/sync";
import { configured } from "../src/lib/supabase";
import { useScheme, useTheme } from "../src/theme";
import { Banner, Button, Loading, Screen, Stack as VStack, Text } from "../src/ui";

export default function RootLayout() {
  const { session, loading } = useSession();
  const router = useRouter();
  const segments = useSegments();
  const c = useTheme();
  const scheme = useScheme();

  useNotificationTaps(useCallback((url: string) => router.push(url as never), [router]));

  const userId = session?.user.id ?? null;
  const hydrated = useStore((s) => s.hydrated);
  const profile = useStore((s) => s.profile);
  const syncStatus = useStore((s) => s.sync.status);

  // Load this user's local data, then keep it in sync. Wipe it on sign-out.
  useEffect(() => {
    if (!userId) {
      useStore.getState().clear();
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    void useStore.getState().hydrate(userId).then(() => {
      if (!cancelled) stop = startSyncLoop();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [userId]);

  const profileReady = !!profile;
  const onboarded = isOnboarded(profile);
  const first = segments[0] as string | undefined;

  // Route gate: signed out -> sign-in; new user -> onboarding; otherwise the app.
  useEffect(() => {
    if (loading) return;
    const open = first === "privacy";
    if (!session) {
      if (first !== "sign-in" && !open) router.replace("/sign-in");
      return;
    }
    if (!hydrated || !profileReady) return;
    if (!onboarded) {
      if (first !== "onboarding" && !open) router.replace("/onboarding");
      return;
    }
    if (first === "sign-in" || (first === "onboarding" && !useStore.getState().profile?.consent_at)) router.replace("/");
  }, [loading, session, hydrated, profileReady, onboarded, first, router]);

  const waiting = loading || (!!session && (!hydrated || !profileReady));
  const stuckOffline = !!session && hydrated && !profileReady && (syncStatus === "offline" || syncStatus === "error");

  if (!configured) {
    return (
      <SafeAreaProvider>
        <Screen>
          <Banner tone="error">The app is missing its Supabase settings (EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY).</Banner>
        </Screen>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <ShareReceiver enabled={!!session && onboarded} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="capture" options={{ presentation: "modal" }} />
      </Stack>
      {waiting ? (
        <View style={{ position: "absolute", inset: 0, backgroundColor: c.bg, justifyContent: "center" }}>
          {stuckOffline ? (
            <Screen>
              <VStack>
                <Text variant="title">Can't load your profile</Text>
                <Text muted>The first sign-in needs an internet connection.</Text>
                <Button title="Try again" onPress={() => void syncAll()} />
              </VStack>
            </Screen>
          )
            : <Loading label="Loading…" />}
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}
