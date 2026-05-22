/*
 * state.ts — Shared Mutable State
 *
 * This file holds the "global state" of the server — a single JavaScript object
 * that any module can import and read or modify. Using one shared object avoids
 * circular dependency problems (where module A imports B and B imports A).
 *
 * What's tracked in the state object:
 * - wsClients:        the set of currently connected WebSocket connections
 * - mqttStatus:       whether the MQTT broker connection is "ok" or "down"
 * - influxStatus:     whether the InfluxDB connection is "ok" or "down"
 * - mqttClient:       the actual MQTT client instance (null before connection)
 * - pipelineSubscriptions: a Map of MQTT topic → subscription config from pipeline.json
 * - wsTopicSubs:      which WebSocket clients are subscribed to which MQTT topics
 * - devices:          a Map of MQTT topic → { online, lastSeen } for device tracking
 * - seenTopics:       all MQTT topics the server has ever received messages on
 * - wsListeners:      registered callback functions for specific message types
 *
 * Two helper functions are also provided:
 * - `broadcast(message)`: sends a JSON message to ALL connected WebSocket clients.
 *   Used for status updates, alert notifications, sensor additions, etc.
 * - `dispatchWs(type, msg)`: calls only the listeners that registered for a
 *   specific message type (a simple pub/sub pattern).
 *
 * Key concepts:
 * - Singleton state pattern: one shared object instead of passing state around
 * - WebSocket broadcast: sending the same message to many clients at once
 * - Pub/sub (publish/subscribe): listeners register for event types they care about
 */
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
