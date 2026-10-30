// Tests the PWA service worker (public/sw.js) logic in a simulated worker environment.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Handler = (event: any) => void;

function makeWorker(network: (req: any) => Promise<any>) {
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Map<string, any>>();
  const shown: any[] = [];
  const opened: string[] = [];
  const openWindows: any[] = [];
  const caches = {
    async open(name: string) {
      const c = store.get(name) ?? new Map();
      store.set(name, c);
      return { put: async (req: any, res: any) => void c.set(typeof req === "string" ? req : req.url, res), keys: async () => [...c.keys()] };
    },
    async match(req: any) {
      const key = typeof req === "string" ? req : req.url;
      for (const c of store.values()) {
        const hit = c.get(key) ?? c.get(new URL(key, "http://app.test").pathname);
        if (hit) return hit;
      }
      return undefined;
    },
    async keys() { return [...store.keys()]; },
    async delete(name: string) { return store.delete(name); },
  };
  const self = {
    location: { origin: "http://app.test" },
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => openWindows, openWindow: async (u: string) => void opened.push(u) },
    registration: { showNotification: async (title: string, opts: any) => void shown.push({ title, ...opts }) },
  };
  vm.runInNewContext(readFileSync(join(__dirname, "../../public/sw.js"), "utf8"), { self, caches, fetch: network, URL, Promise });

  const response = (body: string) => ({ ok: true, body, clone() { return this; } });
  const fire = async (req: { url: string; method?: string; mode?: string }) => {
    let responded: Promise<any> | undefined;
    handlers.fetch!({ request: { method: "GET", mode: "cors", ...req }, respondWith: (p: Promise<any>) => { responded = p; } });
    return responded ? await responded : "passed-through";
  };
  return { fire, caches, response, store, handlers, shown, opened, openWindows };
}

describe("service worker", () => {
  it("serves the cached app shell when a page load happens offline", async () => {
    let online = true;
    const w = makeWorker(async () => { if (!online) throw new TypeError("offline"); return w.response("<html>shell</html>"); });
    expect((await w.fire({ url: "http://app.test/entry/abc", mode: "navigate" })).body).toBe("<html>shell</html>");
    await new Promise((r) => setTimeout(r, 0)); // cache write is fire-and-forget
    online = false;
    expect((await w.fire({ url: "http://app.test/review", mode: "navigate" })).body).toBe("<html>shell</html>");
  });

  it("never intercepts Supabase or other cross-origin calls, or non-GET requests", async () => {
    const w = makeWorker(async () => w.response("x"));
    expect(await w.fire({ url: "https://abc.supabase.co/functions/v1/grade-answer" })).toBe("passed-through");
    expect(await w.fire({ url: "http://app.test/anything", method: "POST" })).toBe("passed-through");
  });

  it("serves static files from cache when offline", async () => {
    let online = true;
    const w = makeWorker(async () => { if (!online) throw new TypeError("offline"); return w.response("js-bundle"); });
    await w.fire({ url: "http://app.test/_expo/static/js/web/entry-1.js" });
    await new Promise((r) => setTimeout(r, 0));
    online = false;
    expect((await w.fire({ url: "http://app.test/_expo/static/js/web/entry-1.js" })).body).toBe("js-bundle");
  });

  it("deletes old caches on activate", async () => {
    const w = makeWorker(async () => w.response("x"));
    await (await w.caches.open("old-cache-v0")).put("a", 1);
    await new Promise<void>((resolve) => w.handlers.activate!({ waitUntil: (p: Promise<unknown>) => void p.then(() => resolve()) }));
    expect(await w.caches.keys()).not.toContain("old-cache-v0");
  });

  it("shows a notification for a push message and opens the page when it is tapped", async () => {
    const w = makeWorker(async () => w.response("x"));
    await new Promise<void>((resolve) =>
      w.handlers.push!({ data: { json: () => ({ title: "Time to review", body: "3 learnings are due today.", url: "/review" }) }, waitUntil: (p: Promise<unknown>) => void p.then(() => resolve()) }));
    expect(w.shown[0]).toMatchObject({ title: "Time to review", body: "3 learnings are due today.", data: { url: "/review" } });

    let closed = false;
    await new Promise<void>((resolve) =>
      w.handlers.notificationclick!({ notification: { close: () => (closed = true), data: { url: "/review" } }, waitUntil: (p: Promise<unknown>) => void p.then(() => resolve()) }));
    expect(closed).toBe(true);
    expect(w.opened).toEqual(["/review"]); // no open window, so a new one is opened
  });

  it("survives a push message with no payload", async () => {
    const w = makeWorker(async () => w.response("x"));
    await new Promise<void>((resolve) => w.handlers.push!({ data: null, waitUntil: (p: Promise<unknown>) => void p.then(() => resolve()) }));
    expect(w.shown[0].title).toBe("Time to review");
  });
});
