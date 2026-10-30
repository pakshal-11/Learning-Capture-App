// Web persistence: IndexedDB (large quota), falling back to localStorage where IndexedDB is unavailable
// (some private-browsing modes). Every call is wrapped: the app must still run if storage is blocked.
import { del, get, set } from "idb-keyval";

const ls = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const kv = {
  async get(key: string): Promise<string | null> {
    try {
      const v = await get<string>(key);
      if (v !== undefined) return v;
    } catch { /* fall through */ }
    return ls()?.getItem(key) ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await set(key, value);
      return;
    } catch { /* fall through */ }
    try {
      ls()?.setItem(key, value);
    } catch { /* storage full or blocked */ }
  },
  async del(key: string): Promise<void> {
    try {
      await del(key);
    } catch { /* ignore */ }
    try {
      ls()?.removeItem(key);
    } catch { /* ignore */ }
  },
};
