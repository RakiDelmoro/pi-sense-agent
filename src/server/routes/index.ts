import { handleAuth } from "./auth";
import { checkAuth } from "../auth";
import { readStore } from "../store";
import { state } from "../state";
import { handleSensors } from "./sensors";
import { handleData } from "./data";
import { handleMqtt } from "./mqtt";
import { handleDevices } from "./devices";
import { handleStore } from "./store";
import { handleAlerts } from "./alerts";
import { handleFiles } from "./files";
import { handleInfluxProxy } from "./influx-proxy";

async function parseBody(req: Request): Promise<any> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data") || ct.includes("text/")) return null;
  try { return await req.json(); } catch { return null; }
}

export async function handleApiRoute(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (!path.startsWith("/api/")) return null;

  // Parse body once for all JSON routes
  const body = await parseBody(req);

  // Auth endpoints (no auth gate)
  const authRes = await handleAuth(path, method, body);
  if (authRes) return authRes;

  // Auth gate for all other routes
  if (!(await checkAuth(req, readStore))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Status
  if (path === "/api/status" && method === "GET") {
    return Response.json({ influxdb: state.influxStatus, mqtt: state.mqttStatus });
  }

  // Sensors
  const sensorsRes = await handleSensors(path, method, url);
  if (sensorsRes) return sensorsRes;

  // Data (query, latest, history, stats, export)
  const dataRes = await handleData(path, method, url);
  if (dataRes) return dataRes;

  // MQTT
  const mqttRes = handleMqtt(path, method, url, body);
  if (mqttRes) return mqttRes;

  // Devices
  const devicesRes = handleDevices(path, method);
  if (devicesRes) return devicesRes;

  // Store
  const storeRes = await handleStore(path, method, body);
  if (storeRes) return storeRes;

  // Alerts
  const alertsRes = await handleAlerts(path, method, body);
  if (alertsRes) return alertsRes;

  // Files (uses req directly for form-data)
  const filesRes = await handleFiles(path, method, req);
  if (filesRes) return filesRes;

  // InfluxDB proxy (uses req directly for body)
  const influxRes = await handleInfluxProxy(path, method, url, req);
  if (influxRes) return influxRes;

  return new Response("Not Found", { status: 404 });
}
