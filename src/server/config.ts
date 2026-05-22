/*
 * config.ts — Centralised Configuration
 *
 * This file is the single source of truth for all settings used across the
 * server. Instead of scattering magic numbers and file paths throughout the
 * code, everything is defined here so other modules just import what they need.
 *
 * Configuration values come from environment variables (which you can set in
 * Docker, your shell, or a .env file), but each has a sensible default for
 * local development so the server works out of the box.
 *
 * What's configured here:
 * - File paths: where sensor folders live, where data files are stored,
 *   where uploaded files go
 * - Server port: which TCP port the HTTP server listens on (default 3000)
 * - InfluxDB: URL, auth token, organisation name, and bucket (database) name
 * - MQTT: broker URL (e.g. tcp://localhost:1883)
 * - Auth: the secret key used to sign JWT tokens
 * - Validation rules: which aggregation functions and fill modes are allowed
 *   in queries, and what duration formats look like (e.g. "15m", "1h", "7d")
 *
 * Two helper functions are also exported:
 * - `serveTs`: compiles a .ts file into JavaScript on the fly using Bun.build,
 *   so the browser can run TypeScript files without a separate build step
 * - `ensureDir`: creates a directory (and any parent directories) if it
 *   doesn't already exist
 *
 * Key concepts:
 * - Environment variables: values passed to the process from outside the code,
 *   ideal for deployment-specific settings without changing code
 * - import.meta.dir: a Bun feature that gives the directory of the current file,
 *   used to resolve paths relative to the project root
 */
import { join } from "node:path";
import { stat, mkdir } from "node:fs/promises";

// ── Paths ──
// import.meta.dir here = /app/src/server/ (in Docker) or /workspace/src/server/ (dev)
export const APP_ROOT = join(import.meta.dir, "../..");

export const SENSORS_DIR = join(APP_ROOT, "sensors");
export const PUBLIC_DIR = join(APP_ROOT, "src/public");
export const PIPELINE_PATH = join(APP_ROOT, "pipeline.json");
export const STORE_PATH = join(APP_ROOT, "store.json");
export const ALERTS_PATH = join(APP_ROOT, "alerts.json");
export const ALERT_HISTORY_PATH = join(APP_ROOT, "alert-history.json");
export const UPLOADS_DIR = join(APP_ROOT, "uploads");

// ── Server ──
export const PORT = Number(process.env.PORT) || 3000;

// ── InfluxDB ──
export const INFLUX_URL = process.env.INFLUX_URL || "http://localhost:8086";
export const INFLUX_TOKEN = process.env.INFLUX_TOKEN || "";
export const INFLUX_ORG = process.env.INFLUX_ORG || "pisense";
export const INFLUX_BUCKET = process.env.INFLUX_BUCKET || "sensors";

// ── MQTT ──
export const MQTT_BROKER = process.env.MQTT_BROKER || "tcp://localhost:1883";

// ── Auth ──
export const JWT_SECRET = process.env.JWT_SECRET || "pisense-local-dev-secret";

// ── Validation ──
export const AGG_FNS = new Set(["mean", "max", "min", "last", "median", "sum", "count"]);
export const FILL_MODES = new Set(["none", "null", "previous"]);
export const DURATION_RE = /^\d+(ms|s|m|h|d|w|mo|y)$/;

// ── Config Log ──
console.log(`[config] PORT=${PORT}`);
console.log(`[config] INFLUX_URL=${INFLUX_URL} ORG=${INFLUX_ORG} BUCKET=${INFLUX_BUCKET}`);
console.log(`[config] INFLUX_TOKEN=${INFLUX_TOKEN ? '***configured***' : '***MISSING — InfluxDB writes disabled***'}`);
console.log(`[config] MQTT_BROKER=${MQTT_BROKER}`);

// ── Helpers ───────────────────────────────

export async function serveTs(filePath: string): Promise<Response> {
  try {
    const result = await Bun.build({ entrypoints: [filePath], target: "browser" });
    const code = await result.outputs[0].text();
    return new Response(code, { headers: { "Content-Type": "application/javascript" } });
  } catch (err: any) {
    return new Response(`Build error: ${err.message}`, { status: 500 });
  }
}

export async function ensureDir(dir: string) {
  try { await stat(dir); } catch { await mkdir(dir, { recursive: true }); }
}
