import { ALERTS_PATH, ALERT_HISTORY_PATH } from "./config";

let alertsCache: any[] | null = null;
let alertHistoryCache: any[] | null = null;

export async function readAlerts(): Promise<any[]> {
  if (alertsCache) return alertsCache;
  try {
    const file = Bun.file(ALERTS_PATH);
    if (!(await file.exists())) { alertsCache = []; return alertsCache; }
    alertsCache = await file.json();
    return alertsCache!;
  } catch {
    alertsCache = [];
    return alertsCache;
  }
}

export async function writeAlerts(data: any[]): Promise<void> {
  alertsCache = data;
  try { await Bun.write(ALERTS_PATH, JSON.stringify(data, null, 2)); }
  catch (e: any) { console.error(`[alerts] Write failed (${e.code || e.message}).`); }
}

export async function readAlertHistory(): Promise<any[]> {
  if (alertHistoryCache) return alertHistoryCache;
  try {
    const file = Bun.file(ALERT_HISTORY_PATH);
    if (!(await file.exists())) { alertHistoryCache = []; return alertHistoryCache; }
    alertHistoryCache = await file.json();
    return alertHistoryCache!;
  } catch {
    alertHistoryCache = [];
    return alertHistoryCache;
  }
}

export async function writeAlertHistory(data: any[]): Promise<void> {
  alertHistoryCache = data;
  try { await Bun.write(ALERT_HISTORY_PATH, JSON.stringify(data, null, 2)); }
  catch (e: any) { console.error(`[alert-history] Write failed (${e.code || e.message}).`); }
}

export function parseDuration(d: string): number {
  const m = d.match(/^(\d+)(ms|s|m|h|d|w|mo|y)$/);
  if (!m) return 900000;
  const n = Number(m[1]);
  const u: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, mo: 2592000000, y: 31536000000 };
  return n * (u[m[2]] || 1000);
}
