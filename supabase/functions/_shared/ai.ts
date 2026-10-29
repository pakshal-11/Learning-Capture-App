// The only place that talks to Anthropic. Every AI feature goes through runTool(), which:
//   1. reserves a call against the per-user daily cap and the global monthly cap (atomic, in SQL)
//   2. calls Claude Haiku with a forced tool schema (structured JSON) and a cached system prompt
//   3. validates the JSON with zod (one retry), then logs tokens and estimated cost to usage_log
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { z } from "npm:zod@3";

export interface Quota {
  used: number;
  limit: number;
}

export type AiOutcome<T> =
  | { ok: true; data: T; quota: Quota }
  | { ok: false; kind: "unavailable" | "error"; reason: string; message: string; quota?: Quota };

interface Pricing {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

const DEFAULT_PRICING: Pricing = { input: 0.10, output: 0.50, cache_write: 0.125, cache_read: 0.01 };
let pricingCache: { at: number; value: Pricing } | null = null;

async function getPricing(service: SupabaseClient): Promise<Pricing> {
  if (pricingCache && Date.now() - pricingCache.at < 60_000) return pricingCache.value;
  const { data } = await service.from("app_config").select("value").eq("key", "ai_pricing").maybeSingle();
  const value = { ...DEFAULT_PRICING, ...(data?.value ?? {}) } as Pricing;
  pricingCache = { at: Date.now(), value };
  return value;
}

export function estimateCost(
  u: { input: number; output: number; cacheWrite: number; cacheRead: number },
  p: Pricing,
): number {
  return (u.input * p.input + u.output * p.output + u.cacheWrite * p.cache_write + u.cacheRead * p.cache_read) / 1e6;
}

const MESSAGES = {
  user_cap: (limit: number) =>
    `You've used today's ${limit} AI helps. Capturing and browsing still work, and AI resets tomorrow.`,
  unavailable: "AI features are temporarily unavailable. Your notes are safe and everything else still works.",
  error: "The AI helper had a problem. Please try again in a moment.",
};

interface RunOptions<S extends z.ZodTypeAny> {
  service: SupabaseClient;
  userId: string;
  action: string;
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: unknown };
  schema: S;
  maxTokens?: number;
}

interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

async function callAnthropic(opts: RunOptions<z.ZodTypeAny>, model: string): Promise<{ input: unknown; usage: Usage }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 500,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: [opts.tool],
      tool_choice: { type: "tool", name: opts.tool.name },
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`anthropic ${res.status}`), { status: res.status });

  const u = body.usage ?? {};
  const block = (body.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  return {
    input: block?.input,
    usage: {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    },
  };
}

export async function runTool<S extends z.ZodTypeAny>(opts: RunOptions<S>): Promise<AiOutcome<z.infer<S>>> {
  const { service } = opts;

  // 1. budget guard
  const { data: res, error } = await service.rpc("reserve_ai_call", { p_user: opts.userId, p_action: opts.action });
  if (error || !res) {
    console.error("reserve_ai_call failed", error);
    return { ok: false, kind: "error", reason: "reserve_failed", message: MESSAGES.error };
  }
  if (!res.ok) {
    const quota = res.limit ? { used: res.used ?? res.limit, limit: res.limit } : undefined;
    return res.reason === "user_cap"
      ? { ok: false, kind: "unavailable", reason: "user_cap", message: MESSAGES.user_cap(res.limit), quota }
      : { ok: false, kind: "unavailable", reason: res.reason, message: MESSAGES.unavailable };
  }
  const quota: Quota = { used: res.used, limit: res.limit };
  const logId: number = res.log_id;

  // 2 + 3. call, validate, retry once
  const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5";
  const total: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let data: z.infer<S> | undefined;
  let lastError = "";

  for (let attempt = 1; attempt <= 2 && data === undefined; attempt++) {
    try {
      const out = await callAnthropic(opts, model);
      total.input += out.usage.input;
      total.output += out.usage.output;
      total.cacheWrite += out.usage.cacheWrite;
      total.cacheRead += out.usage.cacheRead;
      const parsed = opts.schema.safeParse(out.input);
      if (parsed.success) data = parsed.data;
      else lastError = "invalid_output";
    } catch (e) {
      const status = (e as { status?: number }).status;
      lastError = `http_${status ?? "network"}`;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  // 4. log real usage and cost
  const pricing = await getPricing(service);
  const cost = data !== undefined || total.input + total.output > 0 ? estimateCost(total, pricing) : 0;
  await service.rpc("complete_ai_call", {
    p_id: logId,
    p_status: data !== undefined ? "ok" : "error",
    p_model: model,
    p_tokens_in: total.input + total.cacheWrite + total.cacheRead,
    p_tokens_out: total.output,
    p_tokens_cached: total.cacheRead,
    p_cost: cost,
  });

  if (data === undefined) {
    console.error("ai call failed", opts.action, lastError);
    return { ok: false, kind: "error", reason: lastError, message: MESSAGES.error, quota };
  }
  return { ok: true, data, quota };
}

/** Standard JSON body for a failed AI outcome. Budget limits are an expected state (200), not an error. */
export function aiFailureBody(o: Extract<AiOutcome<unknown>, { ok: false }>) {
  return { ok: false, unavailable: o.kind === "unavailable", reason: o.reason, message: o.message, quota: o.quota };
}
