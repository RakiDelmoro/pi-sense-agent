/*
 * watcher.ts — File System Watcher
 *
 * This file monitors the sensors/ directory and pipeline.json for changes,
 * so the server can react immediately without needing a restart.
 *
 * What it watches and why:
 *
 * 1. The sensors/ directory:
 *    Each sensor is a subfolder (e.g. sensors/temperature/) containing three
 *    files: sensor.html, sensor.css, and sensor.ts. These make up the sensor's
 *    custom dashboard widget.
 *    - When a NEW folder appears: the watcher starts monitoring that subfolder.
 *      It waits until all three files exist and are non-empty (with a 500ms
 *      debounce to avoid announcing too early while files are still being
 *      written), then broadcasts "sensor-added" to all WebSocket clients.
 *    - When a folder is DELETED: it stops watching, cleans up, and broadcasts
 *      "sensor-removed" so the dashboard removes the widget.
 *
 * 2. The pipeline.json file:
 *    This file defines which MQTT topics the server should subscribe to and
 *    how to parse incoming sensor data. When this file changes on disk (e.g.
 *    the user adds a new subscription via the dashboard), the watcher triggers
 *    a reload of all MQTT subscriptions without restarting the server.
 *
 * Helper functions:
 * - listSensors():    returns an array of sensor folder names
 * - readPipeline():   reads and parses pipeline.json (returns empty if missing)
 * - writePipeline():  writes updated pipeline config to disk
 * - setWatcherBroadcast(): injects the broadcast function at startup to
 *   avoid circular import dependencies
 *
 * Key concepts:
 * - File system watcher (fs.watch): Node.js API that fires events when files
 *   or directories are created, modified, or deleted
 * - Debouncing: waiting a short time before reacting, to avoid processing
 *   incomplete or duplicate events (e.g. a file being written in chunks)
 * - Circular dependency avoidance: watcher.ts can't import state.ts directly
 *   because state.ts is imported by modules that watcher.ts depends on, so
 *   the broadcast function is injected via setWatcherBroadcast() instead
 */
import { SENSORS_DIR, PIPELINE_PATH } from "./config";
import { readdir, stat, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";

export async function listSensors(): Promise<string[]> {
  try {
    const entries = await readdir(SENSORS_DIR);
    const sensors: string[] = [];
    for (const entry of entries) {
      const s = await stat(join(SENSORS_DIR, entry));
      if (s.isDirectory()) sensors.push(entry);
    }
    return sensors;
  } catch { return []; }
}

export async function readPipeline(): Promise<any> {
  try {
    const file = Bun.file(PIPELINE_PATH);
    if (!(await file.exists())) return { subscriptions: [] };
    return await file.json();
  } catch { return { subscriptions: [] }; }
}

export async function writePipeline(data: any): Promise<void> {
  try {
    await Bun.write(PIPELINE_PATH, JSON.stringify(data, null, 2));
  } catch (e: any) {
    console.error(`[pipeline] Write failed (${e.code || e.message}).`);
  }
}

// ── File watcher ──
const pendingAnnouncements = new Map<string, ReturnType<typeof setTimeout>>();
const sensorWatchers = new Map<string, ReturnType<typeof watch>>();

// Broadcast function injected at startup to avoid circular imports
let _broadcast: (msg: object) => void = () => {};

export function setWatcherBroadcast(fn: (msg: object) => void) {
  _broadcast = fn;
}

function announceSensor(name: string) {
  if (pendingAnnouncements.has(name)) clearTimeout(pendingAnnouncements.get(name)!);
  pendingAnnouncements.set(name, setTimeout(async () => {
    pendingAnnouncements.delete(name);
    const sensorDir = join(SENSORS_DIR, name);
    let allReady = true;
    for (const file of ["sensor.html", "sensor.css", "sensor.ts"]) {
      try {
        const s = await stat(join(sensorDir, file));
        if (!s.isFile() || s.size === 0) { allReady = false; break; }
      } catch { allReady = false; break; }
    }
    if (allReady) _broadcast({ type: "sensor-added", name });
  }, 500));
}

function watchSensorDir(name: string) {
  if (sensorWatchers.has(name)) return;
  try {
    const watcher = watch(join(SENSORS_DIR, name), async () => announceSensor(name));
    sensorWatchers.set(name, watcher);
  } catch { /* not ready */ }
}

function unwatchSensorDir(name: string) {
  const watcher = sensorWatchers.get(name);
  if (watcher) { watcher.close(); sensorWatchers.delete(name); }
}

export function startFileWatcher(reloadPipeline: () => Promise<void>) {
  try {
    watch(SENSORS_DIR, { recursive: false }, async (_event, filename) => {
      if (!filename) return;
      const fullPath = join(SENSORS_DIR, filename);
      try {
        const s = await stat(fullPath);
        if (s.isDirectory()) { watchSensorDir(filename); announceSensor(filename); }
      } catch {
        setTimeout(async () => {
          try {
            const s = await stat(fullPath);
            if (s.isDirectory()) { watchSensorDir(filename); announceSensor(filename); return; }
          } catch { /* gone */ }
          unwatchSensorDir(filename);
          if (pendingAnnouncements.has(filename)) { clearTimeout(pendingAnnouncements.get(filename)!); pendingAnnouncements.delete(filename); }
          _broadcast({ type: "sensor-removed", name: filename });
        }, 300);
      }
    });
    console.log("[watcher] Watching sensors/ directory");
  } catch { console.log("[watcher] sensors/ directory not found"); }

  listSensors().then(names => names.forEach(watchSensorDir));

  try {
    watch(PIPELINE_PATH, async () => {
      console.log("[pipeline] pipeline.json changed, reloading subscriptions");
      await reloadPipeline();
    });
  } catch { /* not yet */ }
}
