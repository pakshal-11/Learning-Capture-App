import { Platform } from "react-native";

/** Short id of the commit this build came from (set by the GitHub build), or "dev" when run locally. */
export const BUILD = (process.env.EXPO_PUBLIC_BUILD ?? "").slice(0, 7) || "dev";

/** Web only: drop the offline copy and reload, so the newest deployed version loads. */
export async function refreshWebApp(): Promise<void> {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return;
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await globalThis.caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => globalThis.caches.delete(k)));
  } catch {
    // reloading is still worth doing
  }
  window.location.reload();
}
