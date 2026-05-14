import { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET } from "../config";

export async function queryInflux(flux: string): Promise<any> {
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
    if (!res.ok) return { error: text };
    try { return JSON.parse(text); } catch { return text; }
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function writeInflux(lineProtocol: string): Promise<boolean> {
  if (!INFLUX_TOKEN) {
    console.error("[influx] Write skipped — INFLUX_TOKEN not set. Line:", lineProtocol);
    return false;
  }
  try {
    const res = await fetch(
      `${INFLUX_URL}/api/v2/write?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(INFLUX_BUCKET)}`,
      {
        method: "POST",
        headers: { Authorization: `Token ${INFLUX_TOKEN}`, "Content-Type": "text/plain; charset=utf-8" },
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

export async function deleteInfluxMeasurement(measurement: string): Promise<boolean> {
  if (!INFLUX_TOKEN) return false;
  try {
    const res = await fetch(
      `${INFLUX_URL}/api/v2/delete?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(INFLUX_BUCKET)}`,
      {
        method: "POST",
        headers: { Authorization: `Token ${INFLUX_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ start: "1970-01-01T00:00:00Z", stop: "2030-01-01T00:00:00Z", predicate: `_measurement="${measurement}"` }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkInfluxStatus(): Promise<"ok" | "down"> {
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
