/*
 * store.ts — Persistent JSON File Store
 *
 * This file provides a simple way to save and load data that needs to survive
 * server restarts. It stores data as JSON files on disk, with an in-memory
 * cache so reads are fast after the first load.
 *
 * How it works:
 * - `createJsonStore(path, fallback)` is a factory function: you give it a file
 *   path and a default value, and it returns an object with `read()` and
 *   `write()` methods.
 * - On first `read()`: loads the file from disk. If the file doesn't exist or
 *   is invalid, returns the fallback default value instead.
 * - On subsequent `read()`: returns the cached data (no disk I/O).
 * - On `write()`: updates both the in-memory cache AND writes to disk, so the
 *   data persists across server restarts.
 *
 * Three store instances are created:
 * - appStore:      general app settings (dashboard layout, auth config, etc.)
 * - alerts:        list of alert rules (e.g. "temperature above 30°C")
 * - alertHistory:  log of alert events that have been triggered
 *
 * Also exports `parseDuration(d)`: converts a human-readable duration string
 * like "15m" or "1h" into milliseconds. Used by alert evaluation to enforce
 * cooldown periods (how long before the same alert can fire again).
 *
 * Key concepts:
 * - JSON file persistence: saving structured data as human-readable text files
 * - In-memory cache: keeping a copy in RAM so repeated reads are instant
 * - Factory pattern: createJsonStore creates a new store instance per file
 * - Duration parsing: "15m" → 900000 (milliseconds), "1h" → 3600000, etc.
 */
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
