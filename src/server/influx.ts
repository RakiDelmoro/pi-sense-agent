import { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET, AGG_FNS, FILL_MODES, DURATION_RE } from "./config";

// ── Client ──────────────────────────────────

export async function queryInflux(flux: string): Promise<any> {
  if (!INFLUX_TOKEN) return { error: "InfluxDB token not configured" };
  try {
    const res = await fetch(
      `${INFLUX_URL}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`,
      {
        method: "POST",
        headers: { Authorization: `Token ${INFLUX_TOKEN}`, "Content-Type": "application/vnd.flux", Accept: "application/csv" },
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
      { method: "POST", headers: { Authorization: `Token ${INFLUX_TOKEN}`, "Content-Type": "text/plain; charset=utf-8" }, body: lineProtocol, signal: AbortSignal.timeout(5000) }
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
      { method: "POST", headers: { Authorization: `Token ${INFLUX_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ start: "1970-01-01T00:00:00Z", stop: "2030-01-01T00:00:00Z", predicate: `_measurement="${measurement}"` }), signal: AbortSignal.timeout(10000) }
    );
    return res.ok;
  } catch { return false; }
}

export async function checkInfluxStatus(): Promise<"ok" | "down"> {
  if (!INFLUX_TOKEN) return "down";
  try {
    const res = await fetch(`${INFLUX_URL}/health`, { headers: { Authorization: `Token ${INFLUX_TOKEN}` }, signal: AbortSignal.timeout(3000) });
    return res.ok ? "ok" : "down";
  } catch { return "down"; }
}

// ── Query Builders ──────────────────────────

export function buildLatestQuery(measurement: string, field: string, tag?: string): string {
  let filter = `|> filter(fn: (r) => r._measurement == "${measurement}")\n  |> filter(fn: (r) => r._field == "${field}")`;
  if (tag) {
    const [key, val] = tag.split("=");
    if (key && val) filter += `\n  |> filter(fn: (r) => r.${key} == "${val}")`;
  }
  return `from(bucket: "${INFLUX_BUCKET}")\n  |> range(start: -30d)\n  ${filter}\n  |> last()`;
}

export function buildHistoryQuery(
  measurement: string, field: string, range: string, tag?: string,
  opts?: { aggregate?: string; fn?: string; fill?: string; start?: string; stop?: string; fields?: string }
): string {
  const fn = (opts?.fn && AGG_FNS.has(opts.fn)) ? opts.fn : "mean";
  const fillMode = (opts?.fill && FILL_MODES.has(opts.fill)) ? opts.fill : "none";

  let fieldFilter: string;
  if (opts?.fields) {
    const parts = opts.fields.split(",").map(f => f.trim()).filter(Boolean).map(f => `r._field == "${f}"`).join(" or ");
    fieldFilter = `|> filter(fn: (r) => ${parts})`;
  } else {
    fieldFilter = `|> filter(fn: (r) => r._field == "${field}")`;
  }

  let filter = `|> filter(fn: (r) => r._measurement == "${measurement}")\n  ${fieldFilter}`;
  if (tag) {
    const [key, val] = tag.split("=");
    if (key && val) filter += `\n  |> filter(fn: (r) => r.${key} == "${val}")`;
  }

  let rangePart: string;
  if (opts?.start && opts?.stop) rangePart = `range(start: ${opts.start}, stop: ${opts.stop})`;
  else if (opts?.start) rangePart = `range(start: ${opts.start})`;
  else rangePart = `range(start: ${range})`;

  let query = `from(bucket: "${INFLUX_BUCKET}")\n  |> ${rangePart}\n  ${filter}`;

  if (opts?.aggregate && DURATION_RE.test(opts.aggregate)) {
    const createEmpty = fillMode !== "none" ? "true" : "false";
    query += `\n  |> aggregateWindow(every: ${opts.aggregate}, fn: ${fn}, createEmpty: ${createEmpty})`;
    if (fillMode === "previous") query += `\n  |> fill(usePrevious: true)`;
  }

  return query;
}

export function buildStatsQuery(measurement: string, field: string, range: string, tag?: string): string {
  let filter = `|> filter(fn: (r) => r._measurement == "${measurement}")\n  |> filter(fn: (r) => r._field == "${field}")`;
  if (tag) {
    const [key, val] = tag.split("=");
    if (key && val) filter += `\n  |> filter(fn: (r) => r.${key} == "${val}")`;
  }
  const base = `from(bucket: "${INFLUX_BUCKET}")\n  |> range(start: ${range})\n  ${filter}`;
  return `${base} |> min() |> yield(name: "min")\n${base} |> max() |> yield(name: "max")\n${base} |> mean() |> yield(name: "mean")\n${base} |> count() |> yield(name: "count")\n${base} |> last() |> yield(name: "last")\n${base} |> first() |> yield(name: "first")`;
}

// ── CSV Parser ──────────────────────────────

export function parseInfluxCsv(csv: string): any[] {
  const lines = csv.trim().split("\n");
  if (lines.length === 0) return [];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#") && lines[i].includes(",")) { headerIdx = i; break; }
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
    const trimmed = val?.trim();
    const numVal = trimmed !== "" ? Number(trimmed) : NaN;
    results.push({
      value: isNaN(numVal) ? (trimmed !== "" ? trimmed : null) : numVal,
      time: timeIdx !== -1 ? cols[timeIdx] : undefined,
      field: fieldIdx !== -1 ? cols[fieldIdx] : undefined,
    });
  }
  return results;
}

export function parseStatsCsv(csv: string): Record<string, any> {
  const stats: Record<string, any> = {};
  const lines = csv.trim().split("\n");
  let currentYield = "";
  let valueIdx = -1;

  for (const line of lines) {
    if (line.startsWith("#group")) continue;
    const yieldMatch = line.match(/^#default,\S*,(\S+)/);
    if (yieldMatch) { currentYield = yieldMatch[1]; continue; }

    if (!line.startsWith("#") && line.includes(",")) {
      if (valueIdx === -1) {
        const parts = line.split(",");
        const vi = parts.indexOf("_value");
        if (vi !== -1) { valueIdx = vi; continue; }
      }
      if (currentYield && valueIdx !== -1) {
        const cols = line.split(",");
        if (cols.length > valueIdx) {
          const raw = cols[valueIdx]?.trim();
          const num = Number(raw);
          stats[currentYield] = isNaN(num) ? raw : num;
        }
      }
    }
  }
  return stats;
}
