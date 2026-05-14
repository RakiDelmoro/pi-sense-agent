import { join } from "node:path";

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
