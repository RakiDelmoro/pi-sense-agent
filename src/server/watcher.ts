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
