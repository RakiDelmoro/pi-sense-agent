import { readdir, stat, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";

// ── Config ──
const PORT = 3000;
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

// ── State ──
const wsClients = new Set<WebSocket>();
let mqttStatus: "ok" | "down" = "down";
let influxStatus: "ok" | "down" = "down";
let mqttClient: any = null;
let pipelineSubscriptions: Map<string, any> = new Map();

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
          Accept: "application/json",
        },
        body: flux,
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { error: text };
    }
    return await res.json();
  } catch (err: any) {
    return { error: err.message };
  }
}

// ── InfluxDB Write ──
async function writeInflux(lineProtocol: string): Promise<boolean> {
  if (!INFLUX_TOKEN) return false;
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
    return res.ok;
  } catch {
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
  return `from(bucket: "${INFLUX_BUCKET}")\n  |> range(start: -1h)\n  ${filter}\n  |> last()`;
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
    const numVal = Number(val);
    results.push({
      value: isNaN(numVal) ? val : numVal,
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

    // Use broker from first subscription or default
    const broker = subs[0]?.mqtt_broker || MQTT_BROKER;

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

      const raw = payload.toString();
      let fields: Record<string, number | string> = {};

      try {
        if (sub.data_format === "json") {
          const parsed = JSON.parse(raw);
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
      const fieldParts = Object.entries(fields).map(([k, v]) =>
        typeof v === "number" ? `${k}=${v}` : `${k}="${v}"`
      );
      line += " " + fieldParts.join(",");

      const ok = await writeInflux(line);
      if (!ok) {
        influxStatus = "down";
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
function startFileWatcher() {
  try {
    watch(SENSORS_DIR, { recursive: false }, async (event, filename) => {
      if (!filename) return;
      const fullPath = join(SENSORS_DIR, filename);
      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) {
          if (event === "rename") {
            // New sensor folder created
            broadcast({ type: "sensor-added", name: filename });
          }
        }
      } catch {
        // Directory was removed
        if (event === "rename") {
          broadcast({ type: "sensor-removed", name: filename });
        }
      }
    });
    console.log("[watcher] Watching sensors/ directory");
  } catch {
    console.log("[watcher] sensors/ directory not found, skipping watcher");
  }

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

      // GET /api/sensors/:name/car.html|css|ts — serve sensor files
      const sensorFileMatch = path.match(
        /^\/api\/sensors\/([^/]+)\/(car\.(html|css|ts))$/
      );
      if (sensorFileMatch && req.method === "GET") {
        const [, name, file, ext] = sensorFileMatch;
        const filePath = join(SENSORS_DIR, name, file);
        const bunFile = Bun.file(filePath);
        if (!(await bunFile.exists())) {
          return new Response("Not Found", { status: 404 });
        }
        if (ext === "ts") {
          const source = await bunFile.text();
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

          // Remove from pipeline.json
          const pipeline = await readPipeline();
          pipeline.subscriptions = pipeline.subscriptions.filter(
            (s: any) => s.sensor !== name
          );
          await writePipeline(pipeline);

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
    },
    message(ws, message) {
      // Client messages not needed for now
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
