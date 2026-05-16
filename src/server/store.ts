import { STORE_PATH, ALERTS_PATH, ALERT_HISTORY_PATH } from "./config";

// ── Generic JSON file store with in-memory cache ──

export function createJsonStore<T>(path: string, fallback: T) {
  let cache: T | null = null;
  return {
    async read(): Promise<T> {
      if (cache) return cache;
      try { cache = await Bun.file(path).json(); } catch { cache = fallback; }
      return cache;
    },
    async write(data: T): Promise<void> {
      cache = data;
      try { await Bun.write(path, JSON.stringify(data, null, 2)); }
      catch (e: any) { console.error(`[store:${path}] Write failed: ${e.message}`); }
    },
  };
}

// ── Instances ──

export const appStore = createJsonStore<Record<string, any>>(STORE_PATH, {});
export const alerts = createJsonStore<any[]>(ALERTS_PATH, []);
export const alertHistory = createJsonStore<any[]>(ALERT_HISTORY_PATH, []);

// ── Duration parser (used by alert evaluation) ──

export function parseDuration(d: string): number {
  const m = d.match(/^(\d+)(ms|s|m|h|d|w|mo|y)$/);
  if (!m) return 900000;
  const n = Number(m[1]);
  const u: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, mo: 2592000000, y: 31536000000 };
  return n * (u[m[2]] || 1000);
}
