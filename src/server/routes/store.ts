import { readStore, writeStore } from "../store";
import { broadcast, dispatchWs } from "../state";

export async function handleStore(path: string, method: string, body?: any): Promise<Response | null> {
  // GET /api/store
  if (path === "/api/store" && method === "GET") {
    const store = await readStore();
    return Response.json({ keys: Object.keys(store) });
  }

  // /api/store/:key
  const storeKeyMatch = path.match(/^\/api\/store\/(.+)$/);
  if (storeKeyMatch) {
    const key = storeKeyMatch[1];
    if (key.includes("..") || key.includes("/") || key.includes("\\")) {
      return Response.json({ error: "Invalid key" }, { status: 400 });
    }

    if (method === "GET") {
      const store = await readStore();
      if (!(key in store)) return Response.json({ error: "Key not found" }, { status: 404 });
      return Response.json(store[key]);
    }
    if (method === "PUT") {
      const value = body;
      const store = await readStore();
      store[key] = value;
      await writeStore(store);
      broadcast({ type: "store-changed", key });
      dispatchWs("store-changed", { key });
      return Response.json({ ok: true });
    }
    if (method === "DELETE") {
      const store = await readStore();
      if (key in store) { delete store[key]; await writeStore(store); }
      broadcast({ type: "store-changed", key });
      return Response.json({ ok: true });
    }
  }

  return null;
}
