// Web/PWA reminders via the Push API. Needs the service worker (public/sw.js) and a VAPID public key.
import { Platform } from "react-native";
import { supabase } from "./supabase";

export type PushStatus = "on" | "off" | "denied" | "needs-install" | "unsupported" | "not-configured";

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? "";

const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

function urlBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (Platform.OS !== "web" || typeof window === "undefined") return "unsupported";
  // iPhones only get Web Push once the app is added to the Home Screen.
  if (isIos() && !isInstalled()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "not-configured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && (await currentSubscription())) return "on";
  return "off";
}

export async function enablePush(): Promise<{ ok: boolean; message?: string }> {
  const status = await getPushStatus();
  if (status === "needs-install") return { ok: false, message: "On iPhone, first tap Share > Add to Home Screen, then open Learning Log from there." };
  if (status === "unsupported") return { ok: false, message: "This browser can't show notifications." };
  if (status === "not-configured") return { ok: false, message: "Notifications aren't set up in this build yet." };
  if (status === "denied") return { ok: false, message: "Notifications are blocked. Allow them in your browser's site settings, then try again." };
  try {
    if ((await Notification.requestPermission()) !== "granted") return { ok: false, message: "Notifications weren't allowed." };
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) }));
    const json = sub.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      { kind: "webpush", token: sub.endpoint, keys: json.keys ?? null, user_agent: navigator.userAgent.slice(0, 200), last_seen: new Date().toISOString() },
      { onConflict: "user_id,token" },
    );
    if (error) return { ok: false, message: "Couldn't save the notification setting. Try again when you're online." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't turn notifications on in this browser." };
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("token", sub.endpoint);
  await sub.unsubscribe();
}

/** Nothing to do on web: the service worker opens the right page when a notification is tapped. */
export function useNotificationTaps(_open: (url: string) => void): void {}
