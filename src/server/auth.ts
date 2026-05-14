import { JWT_SECRET } from "./config";

export function hashPassword(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return hash.toString(36);
}

export function createToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const sig = Buffer.from(JSON.stringify({ header, body, secret: JWT_SECRET })).toString("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (Date.now() - body.iat > 86400000) return null;
    return body;
  } catch {
    return null;
  }
}

export async function isAuthEnabled(readStore: () => Promise<Record<string, any>>): Promise<boolean> {
  const store = await readStore();
  const config = store["auth-config"];
  return !!(config && config.enabled);
}

export async function checkAuth(req: Request, readStore: () => Promise<Record<string, any>>): Promise<boolean> {
  if (!(await isAuthEnabled(readStore))) return true;
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return verifyToken(auth.slice(7)) !== null;
}
