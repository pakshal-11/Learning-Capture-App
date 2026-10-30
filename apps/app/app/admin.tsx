import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../src/lib/supabase";
import { useStore } from "../src/lib/store";
import { Banner, Button, Card, Loading, Row, Screen, Stack, Text } from "../src/ui";

interface Summary {
  limits: { global_monthly_usd: number; user_daily_calls: number; enabled: boolean };
  month: { calls: number; tokens_in: number; tokens_out: number; tokens_cached: number; cost_usd: number; active_users: number };
  by_day: Array<{ day: string; calls: number; cost_usd: number }>;
  by_action: Array<{ action: string; calls: number; cost_usd: number }>;
  top_users: Array<{ user_id: string; calls: number; cost_usd: number }>;
  total_users: number;
}

const usd = (n: number) => `$${Number(n).toFixed(n >= 1 ? 2 : 4)}`;

export default function Admin() {
  const router = useRouter();
  const isAdmin = useStore((s) => s.profile?.is_admin);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: d, error: e } = await supabase.rpc("admin_usage_summary", { p_days: 14 });
    if (e) return setError("Could not load usage. Are you online and an admin?");
    setData(d as Summary);
  }, []);
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  if (!isAdmin) return <Screen><Banner tone="error">Admins only.</Banner><Button title="Back" onPress={() => router.back()} /></Screen>;
  const pct = data ? Math.min(100, (Number(data.month.cost_usd) / Number(data.limits.global_monthly_usd)) * 100) : 0;

  return (
    <Screen footer={<Button title="Back" variant="secondary" onPress={() => router.back()} />}>
      <Stack gap={16}>
        <Text variant="title" accessibilityRole="header">Usage and cost</Text>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!data && !error ? <Loading /> : null}
        {data ? (
          <>
            {!data.limits.enabled ? <Banner tone="warn">AI is switched off (kill switch).</Banner> : null}
            <Card tone="primary">
              <Text variant="label">This month</Text>
              <Text variant="title">{usd(data.month.cost_usd)} <Text muted>of {usd(data.limits.global_monthly_usd)} cap</Text></Text>
              <Text muted>{pct.toFixed(0)}% used · {data.month.calls} AI calls · {data.month.active_users} active users · {data.total_users} users total</Text>
              <Text variant="small" muted>Tokens in {data.month.tokens_in.toLocaleString()} (cached {data.month.tokens_cached.toLocaleString()}) · out {data.month.tokens_out.toLocaleString()}</Text>
              <Text variant="small" muted>Per-user limit: {data.limits.user_daily_calls} calls a day</Text>
            </Card>
            <Card>
              <Text variant="label">By feature</Text>
              {data.by_action.map((a) => <Row key={a.action} style={{ justifyContent: "space-between" }}><Text>{a.action}</Text><Text muted>{a.calls} calls · {usd(a.cost_usd)}</Text></Row>)}
            </Card>
            <Card>
              <Text variant="label">Last 14 days</Text>
              {data.by_day.map((d) => <Row key={d.day} style={{ justifyContent: "space-between" }}><Text>{d.day}</Text><Text muted>{d.calls} calls · {usd(d.cost_usd)}</Text></Row>)}
            </Card>
            <Card>
              <Text variant="label">Top users this month</Text>
              {data.top_users.map((u) => <Row key={u.user_id} style={{ justifyContent: "space-between" }}><Text>{u.user_id.slice(0, 8)}…</Text><Text muted>{u.calls} calls · {usd(u.cost_usd)}</Text></Row>)}
            </Card>
            <Button title="Refresh" variant="secondary" onPress={() => void load()} />
          </>
        ) : null}
      </Stack>
    </Screen>
  );
}
