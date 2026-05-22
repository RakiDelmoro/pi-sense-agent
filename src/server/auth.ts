/*
 * auth.ts — Authentication
 *
 * This file handles user authentication for the dashboard. It provides three
 * main pieces:
 *
 * 1. Password hashing (`hashPassword`):
 *    Converts a plain-text password into a hash (a scrambled, fixed-length
 *    string). The same password always produces the same hash, so we can
 *    compare without ever storing the original password.
 *    NOTE: This uses a simple hash function, not a cryptographic one like
 *    bcrypt. It's fine for a self-hosted/local dashboard, but not suitable
 *    for production-facing applications.
 *
 * 2. JWT token creation (`createToken`) and verification (`verifyToken`):
 *    JWT stands for "JSON Web Token". After login, the server creates a token
 *    (a long string like "eyJhbG...xYz") and sends it to the browser.
 *    The browser includes this token in every subsequent API request so the
 *    server knows who's making the call. Tokens expire after 24 hours.
 *    The token format is: header.payload.signature (three Base64 segments
 *    separated by dots).
 *
 * 3. Auth check helper (`checkAuth`):
 *    Used by every protected API route. If authentication is disabled in the
 *    store settings, it always returns true (no login needed). If enabled,
 *    it looks for a "Bearer <token>" header and verifies the token.
 *
 * Key concepts:
 * - JWT (JSON Web Token): a standard way to represent claims between parties
 * - Bearer token: the browser sends "Authorization: Bearer <token>" in headers
 * - Auth toggle: the dashboard can run with or without login protection
 */
import { JWT_SECRET } from "./config";
import { appStore } from "./store";

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

export async function isAuthEnabled(): Promise<boolean> {
  const store = await appStore.read();
  const config = store["auth-config"];
  return !!(config && config.enabled);
}

export async function checkAuth(req: Request): Promise<boolean> {
  if (!(await isAuthEnabled())) return true;
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return verifyToken(auth.slice(7)) !== null;
}
