import { join } from "node:path";
import { stat, rm } from "node:fs/promises";
import { SENSORS_DIR } from "../config";
import { listSensors, readPipeline, writePipeline } from "../watcher";
import { deleteInfluxMeasurement } from "../influx/client";
import { broadcast } from "../state";

export async function handleSensors(path: string, method: string, url: URL): Promise<Response | null> {
  // GET /api/sensors
  if (path === "/api/sensors" && method === "GET") {
    return Response.json(await listSensors());
  }

  // GET /api/sensors/:name/sensor.html|css|ts
  const sensorFileMatch = path.match(/^\/api\/sensors\/([^/]+)\/(sensor\.(html|css|ts))$/);
  if (sensorFileMatch && method === "GET") {
    const [, name, file, ext] = sensorFileMatch;
    const filePath = join(SENSORS_DIR, name, file);
    const bunFile = Bun.file(filePath);
    if (!(await bunFile.exists())) return new Response("Not Found", { status: 404 });
    if (ext === "ts") {
      try {
        const result = await Bun.build({ entrypoints: [filePath], target: "browser" });
        const code = await result.outputs[0].text();
        return new Response(code, { headers: { "Content-Type": "application/javascript" } });
      } catch (err: any) {
        return new Response(`Build error: ${err.message}`, { status: 500 });
      }
    }
    const ct: Record<string, string> = { html: "text/html", css: "text/css" };
    return new Response(bunFile, { headers: { "Content-Type": ct[ext] || "text/plain" } });
  }

  // DELETE /api/sensors/:name
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

  return null; // not matched
}
