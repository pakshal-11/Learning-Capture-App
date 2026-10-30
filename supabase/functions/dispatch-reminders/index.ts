// Background job (pg_cron, every 5 min): sends "reviews due" push notifications at each user's chosen time.
// Android uses the Expo Push Service (FCM-backed, free). The web app / PWA uses Web Push (VAPID keys in secrets).
import webpush from "npm:web-push@3.6.7";
import { serviceClient } from "../_shared/auth.ts";
import { json, requireCronSecret, serve } from "../_shared/http.ts";

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

const message = (n: number) => (n === 1 ? "1 learning is due today." : `${n} learnings are due today.`);

serve(async (req) => {
  requireCronSecret(req);
  const service = serviceClient();

  const { data: claimed, error } = await service.rpc("claim_due_reminders");
  if (error) throw error;
  const due = ((claimed ?? []) as Array<{ user_id: string; due_count: number }>).filter((r) => r.due_count > 0);
  if (due.length === 0) return json({ ok: true, claimed: claimed?.length ?? 0, sent: 0 });

  const counts = new Map<string, number>();
  for (const r of due) counts.set(r.user_id, Math.max(counts.get(r.user_id) ?? 0, r.due_count));

  const { data: subs } = await service.from("push_subscriptions").select("id, user_id, kind, token, keys")
    .in("user_id", [...counts.keys()]);
  const expo = (subs ?? []).filter((s) => s.kind === "expo");
  const web = (subs ?? []).filter((s) => s.kind === "webpush");

  let sent = 0;
  const dead: string[] = [];

  // --- Android (Expo Push Service)
  for (let i = 0; i < expo.length; i += 100) {
    const batch = expo.slice(i, i + 100);
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(batch.map((s) => ({
        to: s.token,
        title: "Time to review",
        body: message(counts.get(s.user_id) ?? 0),
        data: { url: "/review" },
        sound: "default",
        channelId: "reminders",
      }))),
    });
    const tickets: ExpoTicket[] = (await res.json().catch(() => ({ data: [] }))).data ?? [];
    tickets.forEach((t, idx) => {
      if (t.status === "ok") sent++;
      else if (t.details?.error === "DeviceNotRegistered") dead.push(batch[idx]!.id);
    });
  }

  // --- Web / PWA (Web Push). Skipped, not failed, until the VAPID secrets are set.
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  let skippedWeb = 0;
  if (web.length && (!vapidPublic || !vapidPrivate)) {
    skippedWeb = web.length;
  } else if (web.length) {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:pakshal@bananaclub.co.in", vapidPublic!, vapidPrivate!);
    await Promise.all(web.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.token, keys: s.keys as { p256dh: string; auth: string } },
          JSON.stringify({ title: "Time to review", body: message(counts.get(s.user_id) ?? 0), url: "/review" }),
          { TTL: 6 * 3600 },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id); // the browser says this subscription is gone
      }
    }));
  }

  if (dead.length) await service.from("push_subscriptions").delete().in("id", dead);

  return json({ ok: true, claimed: claimed?.length ?? 0, sent, removed: dead.length, skipped_webpush: skippedWeb });
});
