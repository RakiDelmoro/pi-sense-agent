import { INFLUX_BUCKET, AGG_FNS, FILL_MODES, DURATION_RE } from "../config";

export function buildLatestQuery(measurement: string, field: string, tag?: string): string {
  let filter = `|> filter(fn: (r) => r._measurement == "${measurement}")\n  |> filter(fn: (r) => r._field == "${field}")`;
  if (tag) {
    const [key, val] = tag.split("=");
    if (key && val) filter += `\n  |> filter(fn: (r) => r.${key} == "${val}")`;
  }
  return `from(bucket: "${INFLUX_BUCKET}")\n  |> range(start: -30d)\n  ${filter}\n  |> last()`;
}

export function buildHistoryQuery(
  measurement: string,
  field: string,
  range: string,
  tag?: string,
  opts?: { aggregate?: string; fn?: string; fill?: string; start?: string; stop?: string; fields?: string }
): string {
  const fn = (opts?.fn && AGG_FNS.has(opts.fn)) ? opts.fn : "mean";
  const fillMode = (opts?.fill && FILL_MODES.has(opts.fill)) ? opts.fill : "none";

  let fieldFilter: string;
  if (opts?.fields) {
    const fieldNames = opts.fields.split(",").map(f => f.trim()).filter(Boolean);
    const parts = fieldNames.map(f => `r._field == "${f}"`).join(" or ");
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
