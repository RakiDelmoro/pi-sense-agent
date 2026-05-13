import { readdir, stat, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";

// ── Config ──
const PORT = Number(process.env.PORT) || 3000;

const SENSORS_DIR = join(import.meta.dir, "sensors");
const PUBLIC_DIR = join(import.meta.dir, "public");
const PIPELINE_PATH = join(import.meta.dir, "pipeline.json");

// ── InfluxDB Config ──
const INFLUX_URL = process.env.INFLUX_URL || "http://localhost:8086";
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || "";
const INFLUX_ORG = process.env.INFLUX_ORG || "pisense";
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || "sensors";

// ── MQTT Config ──
const MQTT_BROKER = process.env.MQTT_BROKER || "tcp://localhost:1883";

// ── Config Log ──
console.log(`[config] PORT=${PORT}`);
console.log(`[config] INFLUX_URL=${INFLUX_URL} ORG=${INFLUX_ORG} BUCKET=${INFLUX_BUCKET}`);
console.log(`[config] INFLUX_TOKEN=${INFLUX_TOKEN ? '***configured***' : '***MISSING — InfluxDB writes disabled***'}`);
console.log(`[config] MQTT_BROKER=${MQTT_BROKER}`);

// ── State ──
const wsClients = new Set<WebSocket>();
let mqttStatus: "ok" | "down" = "down";
let influxStatus: "ok" | "down" = "down";
let mqttClient: any = null;
let pipelineSubscriptions: Map<string, any> = new Map();

// ── WebSocket topic subscriptions ──
const wsTopicSubs = new Map<WebSocket, Set<string>>();

// ── Helpers ──
async function listSensors(): Promise<string[]> {
  try {
    const entries = await readdir(SENSORS_DIR);
    const sensors: string[] = [];
    for (const entry of entries) {
      const s = await stat(join(SENSORS_DIR, entry));
      if (s.isDirectory()) sensors.push(entry);
    }
    return sensors;
  } catch {
    return [];
  }
}

async function readPipeline(): Promise<any> {
  try {
    const file = Bun.file(PIPELINE_PATH);
    if (!(await file.exists())) return { subscriptions: [] };
    return await file.json();
  } catch {
    return { subscriptions: [] };
  }
}

async function writePipeline(data: any): Promise<void> {
  await Bun.write(PIPELINE_PATH, JSON.stringify(data, null, 2));
}

function broadcast(message: object) {
  const json = JSON.stringify(message);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

async function checkInfluxStatus(): Promise<"ok" | "down"> {
  if (!INFLUX_TOKEN) return "down";
  try {
    const res = await fetch(`${INFLUX_URL}/health`, {
      headers: { Authorization: `Token ${INFLUX_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

async function checkMqttStatus(): Promise<"ok" | "down"> {
  return mqttClient?.connected ? "ok" : "down";
}

async function updateStatus() {
  const prevInflux = influxStatus;
  const prevMqtt = mqttStatus;
  influxStatus = await checkInfluxStatus();
  mqttStatus = await checkMqttStatus();
  if (prevInflux !== influxStatus || prevMqtt !== mqttStatus) {
    broadcast({ type: "status", influxdb: influxStatus, mqtt: mqttStatus });
  }
}

// ── InfluxDB Query Proxy ──
async function queryInflux(flux: string): Promise<any> {
  if (!INFLUX_TOKEN) return { error: "InfluxDB token not configured" };
  try {
    const res = await fetch(
      `${INFLUX_URL}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${INFLUX_TOKEN}`,
          "Content-Type": "application/vnd.flux",
          Accept: "application/csv",
        },
        body: flux,
        signal: AbortSignal.timeout(10000),
      }
    );
    const text = await res.text();
    if (!res.ok) {
      return { error: text };
    }
    // InfluxDB may return CSV or JSON — handle both
    try {
      return JSON.parse(text);
    } catch {
      return text; // CSV — callers use parseInfluxCsv()
    }
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── InfluxDB Delete Measurement ──
async function deleteInfluxMeasurement(measurement: string): Promise<boolean> {
  if (!INFLUX_TOKEN) return false;
  try {
    const res = await fetch(
      `${INFLUX_URL}/api/v2/delete?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(INFLUX_BUCKET)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${INFLUX_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start: "1970-01-01T00:00:00Z",
          stop: "2030-01-01T00:00:00Z",
          predicate: `_measurement="${measurement}"`,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── InfluxDB Write ──
async function writeInflux(lineProtocol: string): Promise<boolean> {
  if (!INFLUX_TOKEN) {
    console.error("[influx] Write skipped — INFLUX_TOKEN not set. Line:", lineProtocol);
    return false;
  }
  try {
    const res = await fetch(
      `${INFLUX_URL}/api/v2/write?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(INFLUX_BUCKET)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${INFLUX_TOKEN}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: lineProtocol,
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[influx] Write failed (${res.status}): ${body}. Line: ${lineProtocol}`);
    }
    return res.ok;
  } catch (err: any) {
    console.error(`[influx] Write error: ${err.message}. Line: ${lineProtocol}`);
    return false;
  }
}

// ── Flux Query Builders ──
function buildLatestQuery(
  measurement: string,
  field: string,
  tag?: string
): string {
  let filter = `|> filter(fn: (r) => r._measurement == "${measurement}")\n  |> filter(fn: (r) => r._field == "${field}")`;
  if (tag) {
    const [key, val] = tag.split("=");
    if (key && val) {
      filter += `\n  |> filter(fn: (r) => r.${key} == "${val}")`;
    }
  }
  return `from(bucket: "${INFLUX_BUCKET}")\n  |> range(start: -30d)\n  ${filter}\n  |> last()`;
}

function buildHistoryQuery(
  measurement: string,
  field: string,
  range: string,
  tag?: string
): string {
  let filter = `|> filter(fn: (r) => r._measurement == "${measurement}")\n  |> filter(fn: (r) => r._field == "${field}")`;
  if (tag) {
    const [key, val] = tag.split("=");
    if (key && val) {
      filter += `\n  |> filter(fn: (r) => r.${key} == "${val}")`;
    }
  }
  return `from(bucket: "${INFLUX_BUCKET}")\n  |> range(start: ${range})\n  ${filter}`;
}

// ── Parse InfluxDB CSV response to JSON ──
function parseInfluxCsv(csv: string): any[] {
  // InfluxDB returns annotated CSV — find the data rows
  const lines = csv.trim().split("\n");
  if (lines.length === 0) return [];

  // Find header line (starts with #group,false or has column names)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#") && lines[i].includes(",")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const headers = lines[headerIdx].split(",");
  const valueIdx = headers.indexOf("_value");
  const timeIdx = headers.indexOf("_time");
  const fieldIdx = headers.indexOf("_field");

  if (valueIdx === -1) return [];

  const results: any[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("#") || !lines[i].trim()) continue;
    const cols = lines[i].split(",");
    const val = cols[valueIdx];
    const time = timeIdx !== -1 ? cols[timeIdx] : undefined;
    // Try to parse as number
    const trimmed = val?.trim();
    const numVal = trimmed !== "" ? Number(trimmed) : NaN;
    results.push({
      value: isNaN(numVal) ? (trimmed !== "" ? trimmed : null) : numVal,
      time,
      field: fieldIdx !== -1 ? cols[fieldIdx] : undefined,
    });
  }
  return results;
}

// ── MQTT Pipeline ──
async function startMqttPipeline() {
  try {
    const mqtt = await import("mqtt");
    const pipeline = await readPipeline();
    const subs = pipeline.subscriptions || [];

    if (subs.length === 0) {
      console.log("[pipeline] No subscriptions in pipeline.json");
      mqttStatus = "down";
      return;
    }

    const broker = MQTT_BROKER;

    mqttClient = mqtt.connect(broker);
    mqttClient.on("connect", () => {
      console.log(`[mqtt] Connected to ${broker}`);
      mqttStatus = "ok";
      broadcast({ type: "status", influxdb: influxStatus, mqtt: "ok" });

      // Subscribe to all topics
      for (const sub of subs) {
        mqttClient.subscribe(sub.mqtt_topic);
        pipelineSubscriptions.set(sub.mqtt_topic, sub);
        console.log(`[mqtt] Subscribed to ${sub.mqtt_topic}`);
      }
    });

    mqttClient.on("message", async (topic: string, payload: Buffer) => {
      const sub = pipelineSubscriptions.get(topic);
      if (!sub) return;

      // Forward raw MQTT message to subscribed WebSocket clients
      const raw = payload.toString();
      console.log(`[mqtt] Received on ${topic}: ${raw}`);
      for (const [ws, topics] of wsTopicSubs) {
        if (topics.has(topic) && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'mqtt-message', topic, payload: raw }));
        }
      }

      let fields: Record<string, number | string> = {};

      try {
        if (sub.data_format === "json") {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Lenient fallback: handle unquoted keys like {value: 100}
            // by quoting keys before re-parsing
            try {
              const fixed = raw.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":');
              parsed = JSON.parse(fixed);
              console.log(`[mqtt] Lenient JSON parse succeeded`);
            } catch (e2) {
              throw new SyntaxError(`Invalid JSON: ${raw}`);
            }
          }
          for (const [key, type] of Object.entries(sub.fields)) {
            const val = parsed[key];
            if (val !== undefined) fields[key] = type === "float" || type === "int" ? Number(val) : String(val);
          }
        } else if (sub.data_format === "value") {
          const firstKey = Object.keys(sub.fields)[0];
          fields[firstKey] = Number(raw);
        } else if (sub.data_format === "csv") {
          const parts = raw.split(",");
          Object.keys(sub.fields).forEach((key, i) => {
            if (parts[i] !== undefined) {
              const type = sub.fields[key];
              fields[key] = type === "float" || type === "int" ? Number(parts[i]) : String(parts[i]);
            }
          });
        }
      } catch (err) {
        console.error(`[mqtt] Failed to parse payload on ${topic}:`, err);
        return;
      }

      // Build InfluxDB line protocol
      let line = sub.measurement;
      if (sub.tags && Object.keys(sub.tags).length > 0) {
        const tagParts = Object.entries(sub.tags).map(([k, v]) => `${k}=${v}`);
        line += "," + tagParts.join(",");
      }
      // Build InfluxDB line protocol field parts
      // Float fields must have a decimal point (e.g. value=5.0) or InfluxDB
      // stores them as integer, causing type conflicts on later float writes.
      const fieldParts = Object.entries(fields).map(([k, v]) => {
        if (typeof v === "number") {
          const fieldType = sub.fields[k];
          if (fieldType === "float" && Number.isInteger(v)) {
            return `${k}=${v}.0`;
          }
          return `${k}=${v}`;
        }
        return `${k}="${v}"`;
      });
      line += " " + fieldParts.join(",");

      console.log(`[mqtt] Writing to InfluxDB: ${line}`);
      const ok = await writeInflux(line);
      if (ok) {
        influxStatus = "ok";
        console.log(`[mqtt] InfluxDB write OK`);
      } else {
        influxStatus = "down";
        console.error(`[mqtt] InfluxDB write FAILED`);
      }
    });

    mqttClient.on("error", (err: Error) => {
      console.error("[mqtt] Error:", err.message);
      mqttStatus = "down";
      broadcast({ type: "status", influxdb: influxStatus, mqtt: "down" });
    });

    mqttClient.on("close", () => {
      mqttStatus = "down";
      broadcast({ type: "status", influxdb: influxStatus, mqtt: "down" });
    });
  } catch (err: any) {
    console.log("[mqtt] MQTT client not available:", err.message);
    mqttStatus = "down";
  }
}

// ── File Watcher ──
const pendingAnnouncements = new Map<string, ReturnType<typeof setTimeout>>();

function announceSensor(name: string) {
  // Debounce: reset timer on each call
  if (pendingAnnouncements.has(name)) {
    clearTimeout(pendingAnnouncements.get(name)!);
  }
  pendingAnnouncements.set(name, setTimeout(async () => {
    pendingAnnouncements.delete(name);
    // Verify all 3 files exist and are non-empty before announcing
    const sensorDir = join(SENSORS_DIR, name);
    const requiredFiles = ["sensor.html", "sensor.css", "sensor.ts"];
    let allReady = true;
    for (const file of requiredFiles) {
      try {
        const s = await stat(join(sensorDir, file));
        if (!s.isFile() || s.size === 0) {
          allReady = false;
          break;
        }
      } catch {
        allReady = false;
        break;
      }
    }
    if (allReady) {
      broadcast({ type: "sensor-added", name });
    }
    // If not all ready, don't broadcast — the watcher will fire again
    // when the remaining files are written
  }, 500));
}

// ── Per-sensor subdirectory watchers (Linux doesn't support recursive fs.watch) ──
const sensorWatchers = new Map<string, ReturnType<typeof watch>>();

function watchSensorDir(name: string) {
  if (sensorWatchers.has(name)) return;
  const dir = join(SENSORS_DIR, name);
  try {
    const watcher = watch(dir, async (event) => {
      // Any file change in this sensor dir — re-check readiness
      announceSensor(name);
    });
    sensorWatchers.set(name, watcher);
  } catch {
    // Directory may not be ready yet
  }
}

function unwatchSensorDir(name: string) {
  const watcher = sensorWatchers.get(name);
  if (watcher) {
    watcher.close();
    sensorWatchers.delete(name);
  }
}

function startFileWatcher() {
  try {
    // Watch sensors/ directory for subdirectory add/remove only
    watch(SENSORS_DIR, { recursive: false }, async (event, filename) => {
      if (!filename) return;
      const fullPath = join(SENSORS_DIR, filename);
      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          // New sensor directory — start watching it and check readiness
          watchSensorDir(filename);
          announceSensor(filename);
        }
      } catch {
        // Directory was removed
        unwatchSensorDir(filename);
        if (pendingAnnouncements.has(filename)) {
          clearTimeout(pendingAnnouncements.get(filename)!);
          pendingAnnouncements.delete(filename);
        }
        broadcast({ type: "sensor-removed", name: filename });
      }
    });
    console.log("[watcher] Watching sensors/ directory");
  } catch {
    console.log("[watcher] sensors/ directory not found, skipping watcher");
  }

  // Start watchers for any sensors that already exist on boot
  listSensors().then(names => names.forEach(watchSensorDir));

  // Watch pipeline.json for changes
  try {
    watch(PIPELINE_PATH, async () => {
      console.log("[pipeline] pipeline.json changed, reloading subscriptions");
      await reloadPipelineSubscriptions();
    });
  } catch {
    // pipeline.json might not exist yet
  }
}

async function reloadPipelineSubscriptions() {
  const pipeline = await readPipeline();
  const subs = pipeline.subscriptions || [];

  // Unsubscribe from old topics
  if (mqttClient?.connected) {
    for (const [topic] of pipelineSubscriptions) {
      mqttClient.unsubscribe(topic);
    }
  }
  pipelineSubscriptions.clear();

  // Subscribe to new topics
  if (mqttClient?.connected) {
    for (const sub of subs) {
      mqttClient.subscribe(sub.mqtt_topic);
      pipelineSubscriptions.set(sub.mqtt_topic, sub);
      console.log(`[mqtt] Re-subscribed to ${sub.mqtt_topic}`);
    }
  }
}

// ── Periodic Status Check ──
setInterval(updateStatus, 30000);

// ── Server ──
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ── WebSocket upgrade ──
    if (req.headers.get("upgrade") === "websocket") {
      return server.upgrade(req);
    }

    // ── API Routes ──
    if (path.startsWith("/api/")) {
      // GET /api/sensors — list all sensors
      if (path === "/api/sensors" && req.method === "GET") {
        const sensors = await listSensors();
        return Response.json(sensors);
      }

      // GET /api/sensors/:name/sensor.html|css|ts — serve sensor files
      const sensorFileMatch = path.match(
        /^\/api\/sensors\/([^/]+)\/(sensor\.(html|css|ts))$/
      );
      if (sensorFileMatch && req.method === "GET") {
        const [, name, file, ext] = sensorFileMatch;
        const filePath = join(SENSORS_DIR, name, file);
        const bunFile = Bun.file(filePath);
        if (!(await bunFile.exists())) {
          return new Response("Not Found", { status: 404 });
        }
        if (ext === "ts") {
          try {
            const result = await Bun.build({
              entrypoints: [filePath],
              target: "browser",
            });
            const code = await result.outputs[0].text();
            return new Response(code, {
              headers: { "Content-Type": "application/javascript" },
            });
          } catch (err: any) {
            return new Response(`Build error: ${err.message}`, {
              status: 500,
            });
          }
        }
        const contentTypes: Record<string, string> = {
          html: "text/html",
          css: "text/css",
        };
        return new Response(bunFile, {
          headers: { "Content-Type": contentTypes[ext] || "text/plain" },
        });
      }

      // DELETE /api/sensors/:name — remove sensor
      const sensorDeleteMatch = path.match(/^\/api\/sensors\/([^/]+)$/);
      if (sensorDeleteMatch && req.method === "DELETE") {
        const name = sensorDeleteMatch[1];
        const sensorPath = join(SENSORS_DIR, name);
        try {
          await stat(sensorPath);
          await rm(sensorPath, { recursive: true, force: true });

          // Remove from pipeline.json and collect measurements to purge
          const pipeline = await readPipeline();
          const measurementsToPurge = pipeline.subscriptions
            .filter((s: any) => s.sensor === name)
            .map((s: any) => s.measurement);
          pipeline.subscriptions = pipeline.subscriptions.filter(
            (s: any) => s.sensor !== name
          );
          await writePipeline(pipeline);

          // Purge InfluxDB data for each measurement
          for (const measurement of measurementsToPurge) {
            const ok = await deleteInfluxMeasurement(measurement);
            if (!ok) {
              console.error(`[delete] Failed to purge InfluxDB measurement: ${measurement}`);
            } else {
              console.log(`[delete] Purged InfluxDB measurement: ${measurement}`);
            }
          }

          broadcast({ type: "sensor-removed", name });
          return Response.json({ ok: true });
        } catch {
          return new Response("Not Found", { status: 404 });
        }
      }

      // GET /api/status — health check
      if (path === "/api/status" && req.method === "GET") {
        return Response.json({ influxdb: influxStatus, mqtt: mqttStatus });
      }

      // GET /api/query?flux=... — raw Flux query
      if (path === "/api/query" && req.method === "GET") {
        const flux = url.searchParams.get("flux");
        if (!flux) {
          return Response.json({ error: "Missing flux parameter" }, { status: 400 });
        }
        const result = await queryInflux(flux);
        return Response.json(result);
      }

      // GET /api/latest?measurement=x&field=y&tag=k=v
      if (path === "/api/latest" && req.method === "GET") {
        const measurement = url.searchParams.get("measurement");
        const field = url.searchParams.get("field");
        const tag = url.searchParams.get("tag") || undefined;
        if (!measurement || !field) {
          return Response.json(
            { error: "Missing measurement or field" },
            { status: 400 }
          );
        }
        const flux = buildLatestQuery(measurement, field, tag);
        const result = await queryInflux(flux);

        // Try to parse CSV into structured JSON
        if (typeof result === "string") {
          const parsed = parseInfluxCsv(result);
          if (parsed.length > 0) {
            return Response.json(parsed[0]);
          }
          return Response.json({ value: undefined });
        }
        // If already JSON from InfluxDB
        return Response.json(result);
      }

      // GET /api/history?measurement=x&field=y&range=-1h&tag=k=v
      if (path === "/api/history" && req.method === "GET") {
        const measurement = url.searchParams.get("measurement");
        const field = url.searchParams.get("field");
        const range = url.searchParams.get("range") || "-1h";
        const tag = url.searchParams.get("tag") || undefined;
        if (!measurement || !field) {
          return Response.json(
            { error: "Missing measurement or field" },
            { status: 400 }
          );
        }
        const flux = buildHistoryQuery(measurement, field, range, tag);
        const result = await queryInflux(flux);

        if (typeof result === "string") {
          const parsed = parseInfluxCsv(result);
          return Response.json({ values: parsed });
        }
        return Response.json(result);
      }

      return new Response("Not Found", { status: 404 });
    }

    // ── Static files from public/ ──
    const staticPath = path === "/" ? "/index.html" : path;

    // Serve app.js by transpiling app.ts on-the-fly
    if (staticPath === "/app.js") {
      const tsPath = join(PUBLIC_DIR, "/app.ts");
      try {
        const result = await Bun.build({
          entrypoints: [tsPath],
          target: "browser",
        });
        const code = await result.outputs[0].text();
        return new Response(code, {
          headers: { "Content-Type": "application/javascript" },
        });
      } catch (err: any) {
        return new Response(`Build error: ${err.message}`, { status: 500 });
      }
    }

    const filePath = join(PUBLIC_DIR, staticPath);
    const bunFile = Bun.file(filePath);

    if (!(await bunFile.exists())) {
      return new Response("Not Found", { status: 404 });
    }

    // Transpile .ts files to JS
    if (staticPath.endsWith(".ts")) {
      try {
        const result = await Bun.build({
          entrypoints: [filePath],
          target: "browser",
        });
        const code = await result.outputs[0].text();
        return new Response(code, {
          headers: { "Content-Type": "application/javascript" },
        });
      } catch (err: any) {
        return new Response(`Build error: ${err.message}`, { status: 500 });
      }
    }

    return new Response(bunFile);
  },
  websocket: {
    open(ws) {
      wsClients.add(ws);
      // Send current state on connect
      ws.send(
        JSON.stringify({ type: "status", influxdb: influxStatus, mqtt: mqttStatus })
      );
    },
    close(ws) {
      wsClients.delete(ws);
      wsTopicSubs.delete(ws);
    },
    message(ws, message) {
      try {
        const msg = JSON.parse(message as string);
        if (msg.type === 'subscribe' && typeof msg.topic === 'string') {
          if (!wsTopicSubs.has(ws)) wsTopicSubs.set(ws, new Set());
          wsTopicSubs.get(ws)!.add(msg.topic);
        } else if (msg.type === 'unsubscribe' && typeof msg.topic === 'string') {
          wsTopicSubs.get(ws)?.delete(msg.topic);
        }
      } catch {
        // Ignore non-JSON messages
      }
    },
  },
});

console.log(`PiSense Dashboard running on http://localhost:${PORT}`);

// ── Boot ──
(async () => {
  // Ensure sensors/ directory exists
  try {
    await stat(SENSORS_DIR);
  } catch {
    await Bun.write(join(SENSORS_DIR, ".gitkeep"), "");
    console.log("[boot] Created sensors/ directory");
  }

  // Initial status check
  await updateStatus();

  // Start file watcher
  startFileWatcher();

  // Start MQTT pipeline
  await startMqttPipeline();
})();
