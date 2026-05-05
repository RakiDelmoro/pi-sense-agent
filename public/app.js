// public/app.ts
var prompts = [
  "Add a temperature gauge on topic sensors/room/temp",
  "Show humidity as a bar chart, alerts above 70%",
  "Monitor CPU load with a line graph",
  "Track pressure in kPa, refresh every 3s",
  "Create a motion detector, red when active"
];
var promptEl = document.getElementById("cycling-prompt");
var promptIndex = 0;
var charIndex = 0;
var typing = true;
var pauseTimer = null;
function typePrompt() {
  const current = prompts[promptIndex];
  if (typing) {
    charIndex++;
    const visible = current.slice(0, charIndex);
    promptEl.innerHTML = `<span class="prompt-arrow">&gt; </span>${visible}<span class="prompt-cursor">█</span>`;
    if (charIndex < current.length) {
      setTimeout(typePrompt, 40 + Math.random() * 40);
    } else {
      pauseTimer = setTimeout(() => {
        promptEl.style.opacity = "0";
        setTimeout(() => {
          promptIndex = (promptIndex + 1) % prompts.length;
          charIndex = 0;
          promptEl.style.opacity = "1";
          typePrompt();
        }, 400);
      }, 2500);
    }
  }
}
typePrompt();
var emptyState = document.getElementById("empty-state");
var sensorGrid = document.getElementById("sensor-grid");
function updateEmptyState() {
  if (sensorGrid.children.length === 0) {
    emptyState.classList.remove("empty-state--hidden");
  } else {
    emptyState.classList.add("empty-state--hidden");
  }
}
var statusInflux = document.getElementById("status-influx");
var statusMqtt = document.getElementById("status-mqtt");
function updateStatus(influxdb, mqtt) {
  statusInflux.className = "status__indicator" + (influxdb === "ok" ? " status__indicator--ok" : "");
  statusMqtt.className = "status__indicator" + (mqtt === "ok" ? " status__indicator--ok" : "");
}
var modal = document.getElementById("confirm-modal");
var modalText = document.getElementById("modal-text");
var modalConfirm = document.getElementById("modal-confirm");
var modalCancel = document.getElementById("modal-cancel");
var pendingRemoveName = null;
function showRemoveModal(name) {
  pendingRemoveName = name;
  modalText.textContent = `Remove sensor "${name}"?`;
  modal.classList.add("modal--visible");
}
function hideModal() {
  pendingRemoveName = null;
  modal.classList.remove("modal--visible");
}
modalCancel.addEventListener("click", hideModal);
modalConfirm.addEventListener("click", () => {
  if (!pendingRemoveName)
    return;
  const name = pendingRemoveName;
  hideModal();
  fetch(`/api/sensors/${name}`, { method: "DELETE" }).then((res) => {
    if (!res.ok)
      throw new Error("Delete failed");
    unmountSensor(name);
  }).catch((err) => console.error("Failed to remove sensor:", err));
});
var loadedSensors = new Map;
async function loadSensor(name) {
  const [htmlRes, cssRes, tsRes] = await Promise.all([
    fetch(`/api/sensors/${name}/sensor.html`),
    fetch(`/api/sensors/${name}/sensor.css`),
    fetch(`/api/sensors/${name}/sensor.ts`)
  ]);
  if (!htmlRes.ok || !cssRes.ok || !tsRes.ok) {
    console.error(`Failed to load sensor: ${name}`);
    return;
  }
  const html = await htmlRes.text();
  const css = await cssRes.text();
  const ts = await tsRes.text();
  const container = document.createElement("div");
  container.className = `sensor-card sensor-card--${name}`;
  container.innerHTML = html;
  const removeBtn = document.createElement("button");
  removeBtn.className = "sensor-card__remove";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => showRemoveModal(name));
  container.appendChild(removeBtn);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  sensorGrid.appendChild(container);
  const script = document.createElement("script");
  script.textContent = ts;
  document.body.appendChild(script);
  loadedSensors.set(name, { container, style });
  updateEmptyState();
}
function unmountSensor(name) {
  const entry = loadedSensors.get(name);
  if (!entry)
    return;
  const callbacks = unmountCallbacks.get(name);
  if (callbacks) {
    callbacks.forEach((fn) => fn());
    unmountCallbacks.delete(name);
  }
  entry.container.remove();
  entry.style.remove();
  loadedSensors.delete(name);
  updateEmptyState();
}
var mountCallbacks = new Map;
var unmountCallbacks = new Map;
var pollCounter = 0;
var activePolls = new Map;
window.pisense = {
  query: (flux) => fetch(`/api/query?flux=${encodeURIComponent(flux)}`).then((r) => r.json()),
  latest: (measurement, field, tag) => {
    const params = new URLSearchParams({ measurement, field });
    if (tag)
      params.set("tag", tag);
    return fetch(`/api/latest?${params}`).then((r) => r.json());
  },
  history: (measurement, field, range, tag) => {
    const params = new URLSearchParams({ measurement, field, range });
    if (tag)
      params.set("tag", tag);
    return fetch(`/api/history?${params}`).then((r) => r.json());
  },
  poll: (intervalMs, callback) => {
    const id = ++pollCounter;
    activePolls.set(id, setInterval(callback, intervalMs));
    return id;
  },
  stopPoll: (id) => {
    const handle = activePolls.get(id);
    if (handle) {
      clearInterval(handle);
      activePolls.delete(id);
    }
  },
  onMount: (callback) => {
    const lastName = [...loadedSensors.keys()].pop();
    if (lastName) {
      if (!mountCallbacks.has(lastName))
        mountCallbacks.set(lastName, []);
      mountCallbacks.get(lastName).push(callback);
    }
    callback();
  },
  onUnmount: (callback) => {
    const lastName = [...loadedSensors.keys()].pop();
    if (lastName) {
      if (!unmountCallbacks.has(lastName))
        unmountCallbacks.set(lastName, []);
      unmountCallbacks.get(lastName).push(callback);
    }
  }
};
async function init() {
  try {
    const res = await fetch("/api/sensors");
    if (!res.ok)
      return;
    const sensors = await res.json();
    for (const name of sensors) {
      await loadSensor(name);
    }
  } catch {}
  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const status = await res.json();
      updateStatus(status.influxdb, status.mqtt);
    } else {
      updateStatus("down", "down");
    }
  } catch {
    updateStatus("down", "down");
  }
}
init();
var ws = null;
function connectWS() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "sensor-added") {
      loadSensor(msg.name);
    } else if (msg.type === "sensor-removed") {
      unmountSensor(msg.name);
    } else if (msg.type === "sensor-updated") {
      unmountSensor(msg.name);
      loadSensor(msg.name);
    } else if (msg.type === "status") {
      updateStatus(msg.influxdb, msg.mqtt);
    }
  });
  ws.addEventListener("close", () => {
    setTimeout(connectWS, 3000);
  });
}
connectWS();
