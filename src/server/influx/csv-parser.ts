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
    const time = timeIdx !== -1 ? cols[timeIdx] : undefined;
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

export function parseStatsCsv(csv: string): Record<string, any> {
  const stats: Record<string, any> = {};
  const lines = csv.trim().split("\n");
  let currentYield = "";
  let headers: string[] = [];
  let valueIdx = -1;

  for (const line of lines) {
    if (line.startsWith("#group")) continue;
    const yieldMatch = line.match(/^#default,\S*,(\S+)/);
    if (yieldMatch) { currentYield = yieldMatch[1]; continue; }

    if (!line.startsWith("#") && line.includes(",")) {
      if (valueIdx === -1 || headers.length === 0) {
        const parts = line.split(",");
        const vi = parts.indexOf("_value");
        if (vi !== -1) { headers = parts; valueIdx = vi; continue; }
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
