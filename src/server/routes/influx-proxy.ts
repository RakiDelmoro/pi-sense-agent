import { INFLUX_URL, INFLUX_TOKEN } from "../config";

export async function handleInfluxProxy(path: string, method: string, url: URL, req: Request): Promise<Response | null> {
  if (!path.startsWith("/api/influx/")) return null;

  const influxPath = path.slice("/api/influx/".length);
  const targetUrl = `${INFLUX_URL}/${influxPath}${url.search}`;

  const headers: Record<string, string> = { Authorization: `Token ${INFLUX_TOKEN}` };
  const ct = req.headers.get("Content-Type");
  if (ct) headers["Content-Type"] = ct;

  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(10000) };
  if (method !== "GET" && method !== "HEAD") {
    try { init.body = await req.clone().arrayBuffer(); } catch { /* body already consumed */ }
  }

  try {
    const proxyRes = await fetch(targetUrl, init);
    const responseBody = await proxyRes.arrayBuffer();
    const resHeaders: Record<string, string> = {};
    proxyRes.headers.forEach((v, k) => { resHeaders[k] = v; });
    return new Response(responseBody, { status: proxyRes.status, headers: resHeaders });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
