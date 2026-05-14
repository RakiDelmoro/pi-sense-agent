let ws: WebSocket | null = null;
const wsEventListeners = new Map<string, Set<(msg: any) => void>>();

function connectWS() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener("message", (event) => {
    let msg: any;
    try { msg = JSON.parse(event.data); } catch { return; }

    // Dispatch to registered listeners
    const listeners = wsEventListeners.get(msg.type);
    if (listeners) listeners.forEach(fn => fn(msg));

    // Return for external use
    return msg;
  });

  ws.addEventListener("close", () => {
    setTimeout(connectWS, 3000);
  });
}

connectWS();

export function getWs(): WebSocket | null { return ws; }

export function onWs(type: string, callback: (msg: any) => void) {
  if (!wsEventListeners.has(type)) wsEventListeners.set(type, new Set());
  wsEventListeners.get(type)!.add(callback);
}

export function offWs(type: string, callback: (msg: any) => void) {
  wsEventListeners.get(type)?.delete(callback);
}
