/*
 * index.ts — Main Entry Point
 *
 * This is where the entire backend server starts up. Think of it as the "main"
 * function of the application. It does three big things:
 *
 * 1. Creates a Bun HTTP server that:
 *    - Serves the web dashboard (HTML, CSS, JS) as static files
 *    - Compiles TypeScript files on the fly so the browser can run them
 *    - Handles WebSocket connections for real-time updates (live sensor data,
 *      device status, alerts)
 *    - Routes API requests to the handlers in routes.ts
 *
 * 2. Runs a boot sequence when the server first starts:
 *    - Makes sure required folders (sensors/, uploads/) exist
 *    - Creates default data files (store.json, alerts.json, etc.) if missing
 *    - Checks InfluxDB and MQTT connection status
 *    - Starts watching the sensors/ folder for new/removed sensors
 *    - Connects to the MQTT broker and subscribes to sensor topics
 *
 * 3. Runs periodic background tasks:
 *    - Every 30 seconds: checks if InfluxDB and MQTT are still reachable
 *    - Every 30 seconds: evaluates alert rules (e.g. "temperature > 30")
 *    - Every 60 seconds: marks devices as offline if no data received in 5 min
 *
 * Key concepts:
 * - Bun.serve: Bun's built-in HTTP + WebSocket server
 * - WebSocket upgrade: the server promotes certain HTTP requests to WebSocket
 *   connections for two-way real-time communication
 * - import.meta.dir: Bun feature that gives the directory of the current file,
 *   used to resolve relative paths regardless of where you run the server from
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { PORT, PUBLIC_DIR, SENSORS_DIR, UPLOADS_DIR, STORE_PATH, ALERTS_PATH, ALERT_HISTORY_PATH, PIPELINE_PATH, serveTs, ensureDir } from "./config";
import { state, broadcast } from "./state";
import { checkInfluxStatus } from "./influx";
import { setWatcherBroadcast, startFileWatcher } from "./watcher";
import { startMqttPipeline, reloadPipelineSubscriptions } from "./mqtt";
import { evaluateAlerts } from "./routes";
import { handleApiRoute } from "./routes";

// ── Boot helpers ──

async function ensureFile(path: string, content: string) {
  try {
    const s = await stat(path);
    if (s.isDirectory()) {
      console.error(`[boot] ERROR: ${path} is a directory (Docker bind-mount gotcha).`);
      console.error(`[boot] Fix on host: Remove-Item ${path} -Recurse -Force; Set-Content ${path} '${content.trim()}'`);
    }
  } catch {
    try {
      await Bun.write(path, content);
      console.log(`[boot] Created ${path}`);
    } catch (e: any) {
      console.error(`[boot] Cannot create ${path}: ${e.message}`);
    }
  }
}

async function updateStatus() {
  const prevInflux = state.influxStatus;
  const prevMqtt = state.mqttStatus;
  state.influxStatus = await checkInfluxStatus();
  state.mqttStatus = state.mqttClient?.connected ? "ok" : "down";
  if (prevInflux !== state.influxStatus || prevMqtt !== state.mqttStatus) {
    broadcast({ type: "status", influxdb: state.influxStatus, mqtt: state.mqttStatus });
  }
}

// ── Periodic tasks ──
setInterval(updateStatus, 30000);
setInterval(evaluateAlerts, 30000);

setInterval(() => {
  const staleMs = 5 * 60 * 1000;
  const now = Date.now();
  for (const [topic, dev] of state.devices) {
    if (dev.online && now - new Date(dev.lastSeen).getTime() > staleMs) {
      dev.online = false;
      broadcast({ type: "device-status", topic, online: false, lastSeen: dev.lastSeen });
    }
  }
}, 60000);

// ── Server ──
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") return server.upgrade(req);

    // API routes
    const apiRes = await handleApiRoute(req);
    if (apiRes) return apiRes;

    // Static files from public/
    const staticPath = path === "/" ? "/index.html" : path;
    if (staticPath === "/app.js") return serveTs(join(PUBLIC_DIR, "app.ts"));
    if (staticPath.endsWith(".ts")) return serveTs(join(PUBLIC_DIR, staticPath));

    const bunFile = Bun.file(join(PUBLIC_DIR, staticPath));
    return (await bunFile.exists()) ? new Response(bunFile) : new Response("Not Found", { status: 404 });
  },
  websocket: {
    open: (ws) => {
      state.wsClients.add(ws);
      ws.send(JSON.stringify({ type: "status", influxdb: state.influxStatus, mqtt: state.mqttStatus }));
    },
    close: (ws) => {
      state.wsClients.delete(ws);
      state.wsTopicSubs.delete(ws);
    },
    message: (ws, message) => {
      try {
        const msg = JSON.parse(message as string);
        if (msg.type === "subscribe" && typeof msg.topic === "string") {
          if (!state.wsTopicSubs.has(ws)) state.wsTopicSubs.set(ws, new Set());
          state.wsTopicSubs.get(ws)!.add(msg.topic);
        } else if (msg.type === "unsubscribe" && typeof msg.topic === "string") {
          state.wsTopicSubs.get(ws)?.delete(msg.topic);
        } else if (msg.type === "publish" && typeof msg.topic === "string" && msg.payload !== undefined) {
          if (state.mqttClient?.connected) {
            state.mqttClient.publish(msg.topic, String(msg.payload), { retain: msg.retain ?? false });
          }
        } else if (msg.type === "subscribe-device" && typeof msg.topic === "string") {
          if (!state.wsTopicSubs.has(ws)) state.wsTopicSubs.set(ws, new Set());
          state.wsTopicSubs.get(ws)!.add(`device:${msg.topic}`);
        }
      } catch { /* ignore */ }
    },
  },
});

console.log(`PiSense Dashboard running on http://localhost:${PORT}`);

// ── Boot sequence ──
(async () => {
  await ensureDir(SENSORS_DIR);
  await ensureDir(UPLOADS_DIR);
  await ensureFile(STORE_PATH, "{}");
  await ensureFile(ALERTS_PATH, "[]");
  await ensureFile(ALERT_HISTORY_PATH, "[]");

  try {
    const s = await stat(PIPELINE_PATH);
    if (s.isDirectory()) {
      console.error(`[boot] ERROR: pipeline.json is a directory (Docker bind-mount gotcha).`);
      console.error(`[boot] Fix on host: Remove-Item pipeline.json -Recurse -Force; Set-Content pipeline.json '{"subscriptions":[]}'`);
    }
  } catch { /* doesn't exist yet — fine */ }

  setWatcherBroadcast(broadcast);
  await updateStatus();
  startFileWatcher(reloadPipelineSubscriptions);
  await startMqttPipeline();
})();
