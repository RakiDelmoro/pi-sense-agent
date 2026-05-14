// ── Shared mutable state ──
// Single object so modules can import and mutate without circular deps.

export const state = {
  wsClients: new Set<WebSocket>(),
  mqttStatus: "down" as "ok" | "down",
  influxStatus: "down" as "ok" | "down",
  mqttClient: null as any,
  pipelineSubscriptions: new Map<string, any>(),
  wsTopicSubs: new Map<WebSocket, Set<string>>(),
  devices: new Map<string, { online: boolean; lastSeen: string }>(),
  seenTopics: new Set<string>(),
  wsListeners: new Map<string, Set<(msg: any) => void>>(),
};

export function broadcast(message: object) {
  const json = JSON.stringify(message);
  for (const ws of state.wsClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

export function dispatchWs(type: string, msg: any) {
  const listeners = state.wsListeners.get(type);
  if (listeners) listeners.forEach(fn => fn(msg));
}
