/*
 * routes.ts — All API Endpoints
 *
 * This file defines every HTTP API route the server exposes. The frontend
 * (web dashboard) calls these endpoints to read sensor data, configure alerts,
 * manage sensors, upload files, and more.
 *
 * The routes are organised into these sections:
 *
 * - Auth:        Login, check if auth is enabled (no password needed to see these)
 * - Sensors:     List sensors, read sensor files (HTML/CSS/TS), delete a sensor
 * - Data:        Query InfluxDB for latest values, historical time-series, stats,
 *                and CSV exports
 * - MQTT:        Publish messages to MQTT, list subscribed/seen topics
 * - Devices:     Show which MQTT devices are online and when they were last seen
 * - Store:       Generic key-value persistence (dashboard layout, settings, etc.)
 * - Alerts:      Create/read/update/delete alert rules, view alert history
 * - Files:       Upload, list, download, and delete files (e.g. sensor images)
 * - InfluxDB:    Proxy requests directly to InfluxDB (used by the dashboard's
 *                built-in data explorer)
 *
 * The main function is `handleApiRoute` — it receives every incoming request,
 * parses the body, checks authentication (except for auth endpoints), and then
 * delegates to the matching section handler above.
 *
 * Alert evaluation (`evaluateAlerts`) also lives here. It runs on a timer
 * (see index.ts) and checks each alert rule against the latest sensor value.
 * If a rule triggers, it broadcasts an event over WebSocket, logs it to
 * alert-history, and optionally calls a webhook URL.
 *
 * Key concepts:
 * - REST API: each URL path + HTTP method (GET/POST/PUT/DELETE) maps to an action
 * - JWT auth gate: all routes except /api/auth/* require a valid Bearer token
 *   if authentication is enabled
 * - InfluxDB Flux: the query language used to ask InfluxDB for data; we build
 *   Flux query strings in influx.ts and send them to the database
 */
// routes.ts — All API endpoints

import { appStore, alerts, alertHistory, parseDuration } from "./store";
import { hashPassword, createToken, checkAuth } from "./auth";
import { state, broadcast, dispatchWs } from "./state";
import {
  queryInflux, writeInflux, deleteInfluxMeasurement, checkInfluxStatus,
  buildLatestQuery, buildHistoryQuery, buildStatsQuery,
  parseInfluxCsv, parseStatsCsv,
} from "./influx";
import { listSensors, readPipeline, writePipeline } from "./watcher";
import { serveTs, ensureDir, SENSORS_DIR, UPLOADS_DIR, INFLUX_URL, INFLUX_TOKEN } from "./config";
import { join } from "node:path";
import { stat, rm, readdir } from "node:fs/promises";

// ── Helpers ──────────────────────────────────

async function parseBody(req: Request): Promise<any> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data") || ct.includes("text/")) return null;
  try { return await req.json(); } catch { return null; }
}

// ── Auth ─────────────────────────────────────

async function handleAuth(path: string, method: string, body?: any): Promise<Response | null> {
  if (path === "/api/auth/status" && method === "GET") {
    const store = await appStore.read();
    const config = store["auth-config"];
    return Response.json({ enabled: !!(config && config.enabled) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const { password } = body || {};
    const store = await appStore.read();
    const config = store["auth-config"];
    if (!config || !config.enabled) return Response.json({ error: "Auth not enabled" }, { status: 400 });
    if (hashPassword(password) !== hashPassword(config.password)) {
      return Response.json({ error: "Invalid password" }, { status: 401 });
    }
    return Response.json({ ok: true, token: createToken({ user: "admin" }) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    return Response.json({ ok: true });
  }

  return null;
}

// ── Sensors ──────────────────────────────────

async function handleSensors(path: string, method: string, url: URL): Promise<Response | null> {
  if (path === "/api/sensors" && method === "GET") {
    return Response.json(await listSensors());
  }

  const sensorFileMatch = path.match(/^\/api\/sensors\/([^/]+)\/(sensor\.(html|css|ts))$/);
  if (sensorFileMatch && method === "GET") {
    const [, name, file, ext] = sensorFileMatch;
    const filePath = join(SENSORS_DIR, name, file);
    const bunFile = Bun.file(filePath);
    if (!(await bunFile.exists())) return new Response("Not Found", { status: 404 });
    if (ext === "ts") return serveTs(filePath);
    const ct: Record<string, string> = { html: "text/html", css: "text/css" };
    return new Response(bunFile, { headers: { "Content-Type": ct[ext] || "text/plain" } });
  }

  const sensorDeleteMatch = path.match(/^\/api\/sensors\/([^/]+)$/);
  if (sensorDeleteMatch && method === "DELETE") {
    const name = sensorDeleteMatch[1];
    try {
      await stat(join(SENSORS_DIR, name));
      await rm(join(SENSORS_DIR, name), { recursive: true, force: true });
      const pipeline = await readPipeline();
      const toPurge = pipeline.subscriptions.filter((s: any) => s.sensor === name).map((s: any) => s.measurement);
      pipeline.subscriptions = pipeline.subscriptions.filter((s: any) => s.sensor !== name);
      await writePipeline(pipeline);
      for (const m of toPurge) {
        const ok = await deleteInfluxMeasurement(m);
        if (!ok) console.error(`[delete] Failed to purge: ${m}`);
        else console.log(`[delete] Purged: ${m}`);
      }
      broadcast({ type: "sensor-removed", name });
      return Response.json({ ok: true });
    } catch { return new Response("Not Found", { status: 404 }); }
  }

  return null;
}

// ── Data ─────────────────────────────────────

async function handleData(path: string, method: string, url: URL): Promise<Response | null> {
  if (path === "/api/query" && method === "GET") {
    const flux = url.searchParams.get("flux");
    if (!flux) return Response.json({ error: "Missing flux parameter" }, { status: 400 });
    return Response.json(await queryInflux(flux));
  }

  if (path === "/api/latest" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const tag = url.searchParams.get("tag") || undefined;
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const result = await queryInflux(buildLatestQuery(measurement, field, tag));
    if (typeof result === "string") {
      const parsed = parseInfluxCsv(result);
      return Response.json(parsed.length > 0 ? parsed[0] : { value: undefined });
    }
    return Response.json(result);
  }

  if (path === "/api/history" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const range = url.searchParams.get("range") || "-1h";
    const tag = url.searchParams.get("tag") || undefined;
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const opts = {
      aggregate: url.searchParams.get("aggregate") || undefined,
      fn: url.searchParams.get("fn") || undefined,
      fill: url.searchParams.get("fill") || undefined,
      start: url.searchParams.get("start") || undefined,
      stop: url.searchParams.get("stop") || undefined,
      fields: url.searchParams.get("fields") || undefined,
    };
    const result = await queryInflux(buildHistoryQuery(measurement, field, range, tag, opts));
    if (typeof result === "string") return Response.json({ values: parseInfluxCsv(result) });
    return Response.json(result);
  }

  if (path === "/api/stats" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const range = url.searchParams.get("range") || "-1h";
    const tag = url.searchParams.get("tag") || undefined;
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const result = await queryInflux(buildStatsQuery(measurement, field, range, tag));
    if (typeof result === "string") return Response.json(parseStatsCsv(result));
    return Response.json(result);
  }

  if (path === "/api/export" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const range = url.searchParams.get("range") || "-1h";
    const tag = url.searchParams.get("tag") || undefined;
    const format = url.searchParams.get("format") || "csv";
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const opts = {
      aggregate: url.searchParams.get("aggregate") || undefined,
      fn: url.searchParams.get("fn") || undefined,
      fill: url.searchParams.get("fill") || undefined,
      start: url.searchParams.get("start") || undefined,
      stop: url.searchParams.get("stop") || undefined,
      fields: url.searchParams.get("fields") || undefined,
    };
    const result = await queryInflux(buildHistoryQuery(measurement, field, range, tag, opts));
    const filename = `${measurement}_${field}.csv`;
    const csvHeaders = { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${filename}"` };

    if (format === "flat") {
      let csv = "timestamp,value\n";
      if (typeof result === "string") {
        for (const row of parseInfluxCsv(result)) {
          csv += `${row.time || ""},${row.value !== null ? row.value : ""}\n`;
        }
      }
      return new Response(csv, { headers: csvHeaders });
    }
    if (typeof result === "string") return new Response(result, { headers: csvHeaders });
    return Response.json(result);
  }

  return null;
}

// ── MQTT ──────────────────────────────────────

function handleMqtt(path: string, method: string, url: URL, body?: any): Response | null {
  if (path === "/api/mqtt/publish" && method === "POST") {
    if (!state.mqttClient?.connected) return Response.json({ error: "MQTT not connected" }, { status: 503 });
    const { topic, payload, retain } = body || {};
    if (!topic || payload === undefined) return Response.json({ error: "Missing topic or payload" }, { status: 400 });
    state.mqttClient.publish(topic, String(payload), { retain: retain ?? false });
    return Response.json({ ok: true });
  }

  if (path === "/api/mqtt/topics" && method === "GET") {
    return Response.json({ subscribed: [...state.pipelineSubscriptions.keys()], seen: [...state.seenTopics] });
  }

  return null;
}

// ── Devices ───────────────────────────────────

function handleDevices(path: string, method: string): Response | null {
  if (path === "/api/devices" && method === "GET") {
    const result: Record<string, { online: boolean; lastSeen: string }> = {};
    for (const [topic, dev] of state.devices) {
      result[topic] = { online: dev.online, lastSeen: dev.lastSeen };
    }
    return Response.json(result);
  }
  return null;
}

// ── Store ─────────────────────────────────────

async function handleStore(path: string, method: string, body?: any): Promise<Response | null> {
  if (path === "/api/store" && method === "GET") {
    const store = await appStore.read();
    return Response.json({ keys: Object.keys(store) });
  }

  const storeKeyMatch = path.match(/^\/api\/store\/(.+)$/);
  if (storeKeyMatch) {
    const key = storeKeyMatch[1];
    if (key.includes("..") || key.includes("/") || key.includes("\\")) {
      return Response.json({ error: "Invalid key" }, { status: 400 });
    }

    if (method === "GET") {
      const store = await appStore.read();
      if (!(key in store)) return Response.json({ error: "Key not found" }, { status: 404 });
      return Response.json(store[key]);
    }
    if (method === "PUT") {
      const store = await appStore.read();
      store[key] = body;
      await appStore.write(store);
      broadcast({ type: "store-changed", key });
      dispatchWs("store-changed", { key });
      return Response.json({ ok: true });
    }
    if (method === "DELETE") {
      const store = await appStore.read();
      if (key in store) { delete store[key]; await appStore.write(store); }
      broadcast({ type: "store-changed", key });
      return Response.json({ ok: true });
    }
  }

  return null;
}

// ── Alerts ────────────────────────────────────

async function handleAlerts(path: string, method: string, body?: any): Promise<Response | null> {
  if (path === "/api/alerts" && method === "GET") {
    return Response.json(await alerts.read());
  }

  if (path === "/api/alerts" && method === "POST") {
    const rule = body;
    if (!rule) return Response.json({ error: "Invalid body" }, { status: 400 });
    const list = await alerts.read();
    rule.id = rule.id || `alert-${Date.now()}`;
    rule.enabled = rule.enabled ?? true;
    rule._lastTriggered = 0;
    list.push(rule);
    await alerts.write(list);
    return Response.json({ ok: true, id: rule.id });
  }

  const alertIdMatch = path.match(/^\/api\/alerts\/(.+)$/);
  if (alertIdMatch) {
    const id = alertIdMatch[1];

    if (id === "history" && method === "GET") {
      return Response.json(await alertHistory.read());
    }

    if (method === "PUT") {
      const list = await alerts.read();
      const idx = list.findIndex((a: any) => a.id === id);
      if (idx === -1) return Response.json({ error: "Not found" }, { status: 404 });
      list[idx] = { ...list[idx], ...body, id };
      await alerts.write(list);
      return Response.json({ ok: true });
    }

    if (method === "DELETE") {
      const list = await alerts.read();
      await alerts.write(list.filter((a: any) => a.id !== id));
      return Response.json({ ok: true });
    }
  }

  return null;
}

// ── Alert evaluation (called on interval) ────

export async function evaluateAlerts() {
  const list = await alerts.read();
  const now = Date.now();

  for (const rule of list) {
    if (!rule.enabled) continue;
    if (rule._lastTriggered && now - rule._lastTriggered < parseDuration(rule.cooldown || "15m")) continue;

    try {
      const flux = buildLatestQuery(rule.measurement, rule.field, rule.tag);
      const result = await queryInflux(flux);

      let value: number | null = null;
      if (typeof result === "string") {
        const parsed = parseInfluxCsv(result);
        if (parsed.length > 0 && typeof parsed[0].value === "number") value = parsed[0].value;
      } else if (result && result.value !== undefined) {
        value = Number(result.value);
      }
      if (value === null || isNaN(value)) continue;

      let triggered = false;
      if (rule.condition === "above" && value > rule.threshold) triggered = true;
      else if (rule.condition === "below" && value < rule.threshold) triggered = true;
      else if (rule.condition === "equal" && Math.abs(value - rule.threshold) < 0.001) triggered = true;

      if (triggered) {
        rule._lastTriggered = now;
        await alerts.write(list);

        const event = {
          rule: { id: rule.id, name: rule.name, measurement: rule.measurement, field: rule.field, condition: rule.condition, threshold: rule.threshold },
          value,
          time: new Date().toISOString(),
        };

        broadcast({ type: "alert-triggered", ...event });
        dispatchWs("alert-triggered", event);

        const history = await alertHistory.read();
        history.unshift(event);
        if (history.length > 100) history.length = 100;
        await alertHistory.write(history);

        if (rule.webhook) {
          try {
            await fetch(rule.webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000) });
          } catch (e: any) { console.error(`[alert] Webhook failed: ${e.message}`); }
        }
      }
    } catch (e: any) { console.error(`[alert] Evaluation error for ${rule.id}:`, e.message); }
  }
}

// ── Files ─────────────────────────────────────

async function handleFiles(path: string, method: string, req: Request): Promise<Response | null> {
  if (path === "/api/upload" && method === "POST") {
    await ensureDir(UPLOADS_DIR);
    const formData = await req.clone().formData().catch(() => null);
    if (!formData) return Response.json({ error: "Invalid form data" }, { status: 400 });
    const file = formData.get("file") as File | null;
    if (!file) return Response.json({ error: "No file provided" }, { status: 400 });
    const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    await Bun.write(join(UPLOADS_DIR, name), file);
    return Response.json({ ok: true, name, url: `/api/files/${name}` });
  }

  if (path === "/api/files" && method === "GET") {
    await ensureDir(UPLOADS_DIR);
    try {
      const entries = await readdir(UPLOADS_DIR);
      const files: string[] = [];
      for (const entry of entries) {
        const s = await stat(join(UPLOADS_DIR, entry));
        if (s.isFile()) files.push(entry);
      }
      return Response.json({ files });
    } catch { return Response.json({ files: [] }); }
  }

  const filesMatch = path.match(/^\/api\/files\/(.+)$/);
  if (filesMatch) {
    const name = filesMatch[1].replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = join(UPLOADS_DIR, name);

    if (method === "GET") {
      const bunFile = Bun.file(filePath);
      if (!(await bunFile.exists())) return new Response("Not Found", { status: 404 });
      return new Response(bunFile);
    }
    if (method === "DELETE") {
      try { await rm(filePath); return Response.json({ ok: true }); }
      catch { return new Response("Not Found", { status: 404 }); }
    }
  }

  return null;
}

// ── InfluxDB Proxy ───────────────────────────

async function handleInfluxProxy(path: string, method: string, url: URL, req: Request): Promise<Response | null> {
  if (!path.startsWith("/api/influx/")) return null;

  const influxPath = path.slice("/api/influx/".length);
  const targetUrl = `${INFLUX_URL}/${influxPath}${url.search}`;

  const headers: Record<string, string> = { Authorization: `Token ${INFLUX_TOKEN}` };
  const ct = req.headers.get("Content-Type");
  if (ct) headers["Content-Type"] = ct;

  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(10000) };
  if (method !== "GET" && method !== "HEAD") {
    try { init.body = await req.clone().arrayBuffer(); } catch { /* body already consumed */ }
  }

  try {
    const proxyRes = await fetch(targetUrl, init);
    const responseBody = await proxyRes.arrayBuffer();
    const resHeaders: Record<string, string> = {};
    proxyRes.headers.forEach((v, k) => { resHeaders[k] = v; });
    return new Response(responseBody, { status: proxyRes.status, headers: resHeaders });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}

// ── Dispatcher ───────────────────────────────

export async function handleApiRoute(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (!path.startsWith("/api/")) return null;

  const body = await parseBody(req);

  // Auth endpoints (no auth gate)
  const authRes = await handleAuth(path, method, body);
  if (authRes) return authRes;

  // Auth gate for all other routes
  if (!(await checkAuth(req, appStore.read))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Status
  if (path === "/api/status" && method === "GET") {
    return Response.json({ influxdb: state.influxStatus, mqtt: state.mqttStatus });
  }

  const res =
    (await handleSensors(path, method, url)) ||
    (await handleData(path, method, url)) ||
    handleMqtt(path, method, url, body) ||
    handleDevices(path, method) ||
    (await handleStore(path, method, body)) ||
    (await handleAlerts(path, method, body)) ||
    (await handleFiles(path, method, req)) ||
    (await handleInfluxProxy(path, method, url, req));

  return res || new Response("Not Found", { status: 404 });
}
