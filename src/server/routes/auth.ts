import { hashPassword, createToken } from "../auth";
import { readStore } from "../store";

export async function handleAuth(path: string, method: string, body?: any): Promise<Response | null> {
  // GET /api/auth/status (no auth required)
  if (path === "/api/auth/status" && method === "GET") {
    const store = await readStore();
    const config = store["auth-config"];
    return Response.json({ enabled: !!(config && config.enabled) });
  }

  // POST /api/auth/login
  if (path === "/api/auth/login" && method === "POST") {
    const { password } = body || {};
    const store = await readStore();
    const config = store["auth-config"];
    if (!config || !config.enabled) return Response.json({ error: "Auth not enabled" }, { status: 400 });
    if (hashPassword(password) !== hashPassword(config.password)) {
      return Response.json({ error: "Invalid password" }, { status: 401 });
    }
    return Response.json({ ok: true, token: createToken({ user: "admin" }) });
  }

  // POST /api/auth/logout
  if (path === "/api/auth/logout" && method === "POST") {
    return Response.json({ ok: true });
  }

  return null;
}
