import { state } from "../state";

export function handleMqtt(path: string, method: string, url: URL, body?: any): Response | null {
  // POST /api/mqtt/publish
  if (path === "/api/mqtt/publish" && method === "POST") {
    if (!state.mqttClient?.connected) return Response.json({ error: "MQTT not connected" }, { status: 503 });
    const { topic, payload, retain } = body || {};
    if (!topic || payload === undefined) return Response.json({ error: "Missing topic or payload" }, { status: 400 });
    state.mqttClient.publish(topic, String(payload), { retain: retain ?? false });
    return Response.json({ ok: true });
  }

  // GET /api/mqtt/topics
  if (path === "/api/mqtt/topics" && method === "GET") {
    // Lazy import to avoid circular
    const subscribed = [...state.pipelineSubscriptions.keys()];
    return Response.json({ subscribed, seen: [...state.seenTopics] });
  }

  return null;
}
