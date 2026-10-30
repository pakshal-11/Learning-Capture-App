// Android reminders via the Expo Push Service (delivered by Google's FCM). Needs a Firebase project linked to Expo; see docs/APP.md.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export type PushStatus = "on" | "off" | "denied" | "needs-install" | "unsupported" | "not-configured";

const CHANNEL = "reminders";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const projectId = (): string | undefined => {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
};

async function tokenRow(): Promise<string | null> {
  const { data } = await supabase.from("push_subscriptions").select("token").eq("kind", "expo").limit(1);
  return data?.[0]?.token ?? null;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (Platform.OS !== "android" || !Device.isDevice) return "unsupported";
  if (!projectId()) return "not-configured";
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status === "denied" && !perm.canAskAgain) return "denied";
  return perm.granted && (await tokenRow()) ? "on" : "off";
}

export async function enablePush(): Promise<{ ok: boolean; message?: string }> {
  const status = await getPushStatus();
  if (status === "unsupported") return { ok: false, message: "Reminders need a real Android phone." };
  if (status === "not-configured") return { ok: false, message: "Notifications aren't set up in this build yet." };
  if (status === "denied") return { ok: false, message: "Notifications are off. Turn them on in Android Settings > Apps > Learning Log > Notifications." };
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Review reminders", importance: Notifications.AndroidImportance.DEFAULT });
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return { ok: false, message: "Notifications weren't allowed." };
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId()! })).data;
    const { error } = await supabase.from("push_subscriptions").upsert(
      { kind: "expo", token, user_agent: `${Device.modelName ?? "android"}`.slice(0, 200), last_seen: new Date().toISOString() },
      { onConflict: "user_id,token" },
    );
    if (error) return { ok: false, message: "Couldn't save the notification setting. Try again when you're online." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't turn on notifications. Check your connection and try again." };
  }
}

export async function disablePush(): Promise<void> {
  const token = await tokenRow();
  if (token) await supabase.from("push_subscriptions").delete().eq("token", token);
}

/** Opens the screen named in a tapped notification (the reminder job sends `data.url`). */
export function useNotificationTaps(open: (url: string) => void): void {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const url = r.notification.request.content.data?.url;
      if (typeof url === "string" && url.startsWith("/")) open(url);
    });
    return () => sub.remove();
  }, [open]);
}
