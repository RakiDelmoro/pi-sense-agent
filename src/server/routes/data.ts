import { queryInflux } from "../influx/client";
import { parseInfluxCsv, parseStatsCsv } from "../influx/csv-parser";
import { buildLatestQuery, buildHistoryQuery, buildStatsQuery } from "../influx/queries";

export async function handleData(path: string, method: string, url: URL): Promise<Response | null> {
  // GET /api/query?flux=...
  if (path === "/api/query" && method === "GET") {
    const flux = url.searchParams.get("flux");
    if (!flux) return Response.json({ error: "Missing flux parameter" }, { status: 400 });
    return Response.json(await queryInflux(flux));
  }

  // GET /api/latest
  if (path === "/api/latest" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const tag = url.searchParams.get("tag") || undefined;
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const result = await queryInflux(buildLatestQuery(measurement, field, tag));
    if (typeof result === "string") {
      const parsed = parseInfluxCsv(result);
      return Response.json(parsed.length > 0 ? parsed[0] : { value: undefined });
    }
    return Response.json(result);
  }

  // GET /api/history
  if (path === "/api/history" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const range = url.searchParams.get("range") || "-1h";
    const tag = url.searchParams.get("tag") || undefined;
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const opts = {
      aggregate: url.searchParams.get("aggregate") || undefined,
      fn: url.searchParams.get("fn") || undefined,
      fill: url.searchParams.get("fill") || undefined,
      start: url.searchParams.get("start") || undefined,
      stop: url.searchParams.get("stop") || undefined,
      fields: url.searchParams.get("fields") || undefined,
    };
    const result = await queryInflux(buildHistoryQuery(measurement, field, range, tag, opts));
    if (typeof result === "string") {
      return Response.json({ values: parseInfluxCsv(result) });
    }
    return Response.json(result);
  }

  // GET /api/stats
  if (path === "/api/stats" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const range = url.searchParams.get("range") || "-1h";
    const tag = url.searchParams.get("tag") || undefined;
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const result = await queryInflux(buildStatsQuery(measurement, field, range, tag));
    if (typeof result === "string") return Response.json(parseStatsCsv(result));
    return Response.json(result);
  }

  // GET /api/export
  if (path === "/api/export" && method === "GET") {
    const measurement = url.searchParams.get("measurement");
    const field = url.searchParams.get("field");
    const range = url.searchParams.get("range") || "-1h";
    const tag = url.searchParams.get("tag") || undefined;
    const format = url.searchParams.get("format") || "csv";
    if (!measurement || !field) return Response.json({ error: "Missing measurement or field" }, { status: 400 });
    const opts = {
      aggregate: url.searchParams.get("aggregate") || undefined,
      fn: url.searchParams.get("fn") || undefined,
      fill: url.searchParams.get("fill") || undefined,
      start: url.searchParams.get("start") || undefined,
      stop: url.searchParams.get("stop") || undefined,
      fields: url.searchParams.get("fields") || undefined,
    };
    const result = await queryInflux(buildHistoryQuery(measurement, field, range, tag, opts));
    const filename = `${measurement}_${field}.csv`;

    if (format === "flat") {
      let csv = "timestamp,value\n";
      if (typeof result === "string") {
        for (const row of parseInfluxCsv(result)) {
          csv += `${row.time || ""},${row.value !== null ? row.value : ""}\n`;
        }
      }
      return new Response(csv, {
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${filename}"` },
      });
    }
    if (typeof result === "string") {
      return new Response(result, {
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${filename}"` },
      });
    }
    return Response.json(result);
  }

  return null;
}
