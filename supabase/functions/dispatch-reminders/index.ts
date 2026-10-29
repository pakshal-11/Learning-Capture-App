// Background job (pg_cron, every 5 min): sends "reviews due" push notifications at each user's chosen time.
// Android uses the Expo Push Service (FCM-backed, free). Web Push sending is added with the PWA in Phase 2b.
import { serviceClient } from "../_shared/auth.ts";
import { json, requireCronSecret, serve } from "../_shared/http.ts";

interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

serve(async (req) => {
  requireCronSecret(req);
  const service = serviceClient();

  const { data: claimed, error } = await service.rpc("claim_due_reminders");
  if (error) throw error;
  const due = ((claimed ?? []) as Array<{ user_id: string; due_count: number }>).filter((r) => r.due_count > 0);
  if (due.length === 0) return json({ ok: true, claimed: claimed?.length ?? 0, sent: 0 });

  const counts = new Map<string, number>();
  for (const r of due) counts.set(r.user_id, Math.max(counts.get(r.user_id) ?? 0, r.due_count));

  const { data: subs } = await service.from("push_subscriptions").select("id, user_id, kind, token")
    .in("user_id", [...counts.keys()]);
  const expo = (subs ?? []).filter((s) => s.kind === "expo");
  const skippedWeb = (subs ?? []).length - expo.length;

  let sent = 0;
  const dead: string[] = [];
  for (let i = 0; i < expo.length; i += 100) {
    const batch = expo.slice(i, i + 100);
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(batch.map((s) => {
        const n = counts.get(s.user_id) ?? 0;
        return {
          to: s.token,
          title: "Time to review",
          body: n === 1 ? "1 learning is due today." : `${n} learnings are due today.`,
          data: { url: "/review" },
          sound: "default",
        };
      })),
    });
    const tickets: ExpoTicket[] = (await res.json().catch(() => ({ data: [] }))).data ?? [];
    tickets.forEach((t, idx) => {
      if (t.status === "ok") sent++;
      else if (t.details?.error === "DeviceNotRegistered") dead.push(batch[idx]!.id);
    });
  }
  if (dead.length) await service.from("push_subscriptions").delete().in("id", dead);

  return json({ ok: true, claimed: claimed?.length ?? 0, sent, removed: dead.length, skipped_webpush: skippedWeb });
});
