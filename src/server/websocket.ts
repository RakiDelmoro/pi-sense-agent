import { state } from "./state";

export function handleWsOpen(ws: WebSocket) {
  state.wsClients.add(ws);
  ws.send(JSON.stringify({ type: "status", influxdb: state.influxStatus, mqtt: state.mqttStatus }));
}

export function handleWsClose(ws: WebSocket) {
  state.wsClients.delete(ws);
  state.wsTopicSubs.delete(ws);
}

export function handleWsMessage(ws: WebSocket, message: string) {
  try {
    const msg = JSON.parse(message);
    if (msg.type === "subscribe" && typeof msg.topic === "string") {
      if (!state.wsTopicSubs.has(ws)) state.wsTopicSubs.set(ws, new Set());
      state.wsTopicSubs.get(ws)!.add(msg.topic);
    } else if (msg.type === "unsubscribe" && typeof msg.topic === "string") {
      state.wsTopicSubs.get(ws)?.delete(msg.topic);
    } else if (msg.type === "publish" && typeof msg.topic === "string" && msg.payload !== undefined) {
      if (state.mqttClient?.connected) {
        state.mqttClient.publish(msg.topic, String(msg.payload), { retain: msg.retain ?? false });
      }
    } else if (msg.type === "subscribe-device" && typeof msg.topic === "string") {
      if (!state.wsTopicSubs.has(ws)) state.wsTopicSubs.set(ws, new Set());
      state.wsTopicSubs.get(ws)!.add(`device:${msg.topic}`);
    }
  } catch {
    // Ignore non-JSON
  }
}
