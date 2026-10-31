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
  web_search: number; // USD per search request (Anthropic charges $10 per 1,000)
}

const DEFAULT_PRICING: Pricing = { input: 0.10, output: 0.50, cache_write: 0.125, cache_read: 0.01, web_search: 0.01 };
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

// ---------------------------------------------------------------------------------------------- web research

export interface ResearchSource {
  title: string;
  url: string;
}

interface ResearchOptions<S extends z.ZodTypeAny> {
  service: SupabaseClient;
  userId: string;
  system: string;
  user: string;
  tool: { name: string; description: string; input_schema: unknown };
  schema: S;
}

const MAX_SEARCHES = 3;
const MAX_ROUNDS = 4; // searches can pause the turn; each round continues it

/**
 * Like runTool(), but Claude may call Anthropic's web_search tool (at most MAX_SEARCHES times) before it saves
 * the result through `tool`. It has its own daily limit (ai_limits.user_daily_research, default 10, rolling 24 h)
 * on top of the normal caps, and each search is added to the logged cost.
 * Returns the validated data plus the real result pages found, so links shown to the user are never invented.
 */
export async function runResearch<S extends z.ZodTypeAny>(
  opts: ResearchOptions<S>,
): Promise<AiOutcome<{ data: z.infer<S>; results: ResearchSource[] }>> {
  const { service } = opts;

  const { data: cfg } = await service.from("app_config").select("value").eq("key", "ai_limits").maybeSingle();
  const researchCap: number = Number(cfg?.value?.user_daily_research ?? 10);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: usedResearch } = await service.from("usage_log").select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId).eq("action", "research").neq("status", "error").gte("created_at", since);
  if ((usedResearch ?? 0) >= researchCap) {
    return {
      ok: false, kind: "unavailable", reason: "research_cap",
      message: `You've used today's ${researchCap} web look-ups. Your note is still organised, and look-ups reset within a day.`,
    };
  }

  const { data: res, error } = await service.rpc("reserve_ai_call", { p_user: opts.userId, p_action: "research" });
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

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5";
  const total: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let searches = 0;
  let data: z.infer<S> | undefined;
  let lastError = "";
  const results = new Map<string, ResearchSource>();
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: opts.user }];

  try {
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    for (let round = 0; round < MAX_ROUNDS && data === undefined; round++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }, opts.tool],
          tool_choice: { type: "auto" },
          messages,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        lastError = `http_${r.status}`;
        console.error("research call failed", r.status, JSON.stringify(body).slice(0, 300));
        break;
      }
      const u = body.usage ?? {};
      total.input += u.input_tokens ?? 0;
      total.output += u.output_tokens ?? 0;
      total.cacheWrite += u.cache_creation_input_tokens ?? 0;
      total.cacheRead += u.cache_read_input_tokens ?? 0;
      searches += u.server_tool_use?.web_search_requests ?? 0;

      const content: Array<Record<string, unknown>> = body.content ?? [];
      for (const b of content) {
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
          for (const item of b.content as Array<{ url?: string; title?: string }>) {
            if (item.url && !results.has(item.url)) results.set(item.url, { url: item.url, title: item.title ?? item.url });
          }
        }
      }

      const call = content.find((b) => b.type === "tool_use" && b.name === opts.tool.name);
      if (call) {
        const parsed = opts.schema.safeParse(call.input);
        if (parsed.success) data = parsed.data;
        else lastError = "invalid_output";
        break;
      }
      // The turn paused mid-search, or Claude stopped without saving: hand its content back and continue.
      messages.push({ role: "assistant", content });
      if (body.stop_reason !== "pause_turn") {
        messages.push({ role: "user", content: `Now call ${opts.tool.name} with what you found.` });
      }
      lastError = "no_result";
    }
  } catch (e) {
    lastError = `http_${(e as { status?: number }).status ?? "network"}`;
    console.error("research failed", e);
  }

  const pricing = await getPricing(service);
  const cost = estimateCost(total, pricing) + searches * pricing.web_search;
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
    console.error("research failed", lastError);
    return { ok: false, kind: "error", reason: lastError || "no_result", message: MESSAGES.error, quota };
  }
  return { ok: true, data: { data, results: [...results.values()] }, quota };
}

/** Standard JSON body for a failed AI outcome. Budget limits are an expected state (200), not an error. */
export function aiFailureBody(o: Extract<AiOutcome<unknown>, { ok: false }>) {
  return { ok: false, unavailable: o.kind === "unavailable", reason: o.reason, message: o.message, quota: o.quota };
}
