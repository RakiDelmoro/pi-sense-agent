import { state } from "../state";

export function handleDevices(path: string, method: string): Response | null {
  if (path === "/api/devices" && method === "GET") {
    const result: Record<string, { online: boolean; lastSeen: string }> = {};
    for (const [topic, dev] of state.devices) {
      result[topic] = { online: dev.online, lastSeen: dev.lastSeen };
    }
    return Response.json(result);
  }
  return null;
}
