// ── Cycling Prompts ──
const prompts = [
  'Gauge sensor on topic room/temp, min 0 max 50',
  'History chart on topic server/cpu, range 0 to 100',
  'Status panel on topic door/entrance, show open or closed',
  'Gauge on topic tank/level, min 0 max 100, label Water Level',
  'Line chart on topic garden/moisture, last 1 hour',
];

const promptEl = document.getElementById('cycling-prompt') as HTMLElement;
let promptIndex = 0;
let charIndex = 0;
let typing = true;
let pauseTimer: ReturnType<typeof setTimeout> | null = null;

function typePrompt() {
  const current = prompts[promptIndex];

  if (typing) {
    charIndex++;
    const visible = current.slice(0, charIndex);
    promptEl.innerHTML =
      `<span class="prompt-arrow">&gt; </span>${visible}<span class="prompt-cursor">█</span>`;

    if (charIndex < current.length) {
      setTimeout(typePrompt, 40 + Math.random() * 40);
    } else {
      // Finished typing — pause, then fade out
      pauseTimer = setTimeout(() => {
        promptEl.style.opacity = '0';
        setTimeout(() => {
          promptIndex = (promptIndex + 1) % prompts.length;
          charIndex = 0;
          promptEl.style.opacity = '1';
          typePrompt();
        }, 400);
      }, 2500);
    }
  }
}

typePrompt();

// ── Empty State Toggle ──
const emptyState = document.getElementById('empty-state') as HTMLElement;
const sensorGrid = document.getElementById('sensor-grid') as HTMLElement;

function updateEmptyState() {
  if (sensorGrid.children.length === 0) {
    emptyState.classList.remove('empty-state--hidden');
  } else {
    emptyState.classList.add('empty-state--hidden');
  }
}

// ── Status Indicator ──
const statusInflux = document.getElementById('status-influxdb') as HTMLElement;
const statusMqtt = document.getElementById('status-mqtt') as HTMLElement;

function updateStatus(influxdb: 'ok' | 'down', mqtt: 'ok' | 'down') {
  if (influxdb === 'ok') {
    statusInflux.classList.add('status-dot--ok');
  } else {
    statusInflux.classList.remove('status-dot--ok');
  }
  if (mqtt === 'ok') {
    statusMqtt.classList.add('status-dot--ok');
  } else {
    statusMqtt.classList.remove('status-dot--ok');
  }
}

// ── Remove Confirmation Modal ──
const modal = document.getElementById('confirm-modal') as HTMLElement;
const modalText = document.getElementById('modal-text') as HTMLElement;
const modalConfirm = document.getElementById('modal-confirm') as HTMLButtonElement;
const modalCancel = document.getElementById('modal-cancel') as HTMLButtonElement;

let pendingRemoveName: string | null = null;

function showRemoveModal(name: string) {
  pendingRemoveName = name;
  modalText.textContent = `Remove sensor "${name}"?\nAll historical data will also be permanently deleted.`;
  modal.classList.add('modal--visible');
}

function hideModal() {
  pendingRemoveName = null;
  modal.classList.remove('modal--visible');
}

modalCancel.addEventListener('click', hideModal);

modalConfirm.addEventListener('click', () => {
  if (!pendingRemoveName) return;
  const name = pendingRemoveName;
  hideModal();

  fetch(`/api/sensors/${name}`, { method: 'DELETE' })
    .then(res => {
      if (!res.ok) throw new Error('Delete failed');
      unmountSensor(name);
    })
    .catch(err => console.error('Failed to remove sensor:', err));
});

// ── Sensor Loading ──
const loadingSensors = new Set<string>();
const loadedSensors = new Map<string, {
  container: HTMLElement;
  style: HTMLElement;
  listenerCleanups: (() => void)[];
  timerIds: number[];
}>();
const sensorPolls = new Map<string, number[]>();

async function loadSensor(name: string) {
  // Guard: don't load the same sensor twice (even during concurrent calls)
  if (loadedSensors.has(name) || loadingSensors.has(name)) return;
  loadingSensors.add(name);

  let container: HTMLElement;
  let style: HTMLElement;
  const listenerCleanups: (() => void)[] = [];
  const timerIds: number[] = [];

  try {
    const [htmlRes, cssRes, tsRes] = await Promise.all([
      fetch(`/api/sensors/${name}/sensor.html`),
      fetch(`/api/sensors/${name}/sensor.css`),
      fetch(`/api/sensors/${name}/sensor.ts`),
    ]);

    if (!htmlRes.ok || !cssRes.ok || !tsRes.ok) {
      console.error(`Failed to load sensor: ${name}`);
      loadingSensors.delete(name);
      return;
    }

    const html = await htmlRes.text();
    const css = await cssRes.text();
    const ts = await tsRes.text();

    // Container
    container = document.createElement('div');
    container.className = `sensor-card sensor-card--${name}`;
    container.innerHTML = html;

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'sensor-card__remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => showRemoveModal(name));
    container.appendChild(removeBtn);

    // Scoped CSS
    style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Mount container BEFORE executing script (so getElementById works)
    sensorGrid.appendChild(container);

    // Register in loadedSensors BEFORE executing (so onMount/onUnmount see it)
    loadedSensors.set(name, { container, style, listenerCleanups, timerIds });

    // ── Execute sensor script in isolated scope ──
    // Uses string concatenation (NOT template interpolation) because
    // sensor JS may contain backtick template literals.
    const wrapperPreamble =
      'var __psid = arguments[0];\n' +
      'window.__pisenseCurrentSensor__ = __psid;\n' +
      'var _origAE = window.addEventListener.bind(window);\n' +
      'var _origSI = window.setInterval.bind(window);\n' +
      'var _origST = window.setTimeout.bind(window);\n' +
      'window.addEventListener = function(type, fn, opts) {\n' +
      '  window.pisense.trackListener(__psid, type, fn, opts);\n' +
      '  _origAE(type, fn, opts);\n' +
      '};\n' +
      'window.setInterval = function(fn, ms) {\n' +
      '  var id = _origSI(fn, ms);\n' +
      '  window.pisense.trackTimer(__psid, id);\n' +
      '  return id;\n' +
      '};\n' +
      'window.setTimeout = function(fn, ms) {\n' +
      '  var id = _origST(fn, ms);\n' +
      '  window.pisense.trackTimer(__psid, id);\n' +
      '  return id;\n' +
      '};\n' +
      'try {\n';

    const wrapperPostamble =
      '} finally {\n' +
      '  delete window.__pisenseCurrentSensor__;\n' +
      '  window.addEventListener = _origAE;\n' +
      '  window.setInterval = _origSI;\n' +
      '  window.setTimeout = _origST;\n' +
      '}\n';

    const fullCode = wrapperPreamble + ts + wrapperPostamble;
    const sensorFn = new Function(fullCode);
    sensorFn(name);

  } catch (err) {
    // Sensor script threw — clean up partial state
    console.error(`[sensor] Error loading ${name}:`, err);
    if (container) container.remove();
    if (style) style.remove();
    loadedSensors.delete(name);
  } finally {
    loadingSensors.delete(name);
    updateEmptyState();
  }
}

function unmountSensor(name: string) {
  const entry = loadedSensors.get(name);
  if (!entry) return;

  // Run onUnmount callbacks
  const callbacks = unmountCallbacks.get(name);
  if (callbacks) {
    callbacks.forEach(fn => fn());
    unmountCallbacks.delete(name);
  }
  mountCallbacks.delete(name);

  // Stop all pisense.poll() intervals
  const polls = sensorPolls.get(name);
  if (polls) {
    polls.forEach(id => {
      const handle = activePolls.get(id);
      if (handle) { clearInterval(handle); activePolls.delete(id); }
    });
    sensorPolls.delete(name);
  }

  // Remove all tracked window event listeners
  entry.listenerCleanups.forEach(fn => fn());

  // Clear all tracked timers (setInterval / setTimeout)
  entry.timerIds.forEach(id => {
    clearInterval(id);
    clearTimeout(id);
  });

  // Remove DOM elements
  entry.container.remove();
  entry.style.remove();
  loadedSensors.delete(name);
  updateEmptyState();
}

// ── pisense API ──
const mountCallbacks = new Map<string, (() => void)[]>();
const unmountCallbacks = new Map<string, (() => void)[]>();
let pollCounter = 0;
const activePolls = new Map<number, ReturnType<typeof setInterval>>();

(window as any).pisense = {
  query: (flux: string) =>
    fetch(`/api/query?flux=${encodeURIComponent(flux)}`).then(r => r.json()),

  latest: (measurement: string, field: string, tag?: string) => {
    const params = new URLSearchParams({ measurement, field });
    if (tag) params.set('tag', tag);
    return fetch(`/api/latest?${params}`).then(r => r.json());
  },

  history: (measurement: string, field: string, range: string, tag?: string) => {
    const params = new URLSearchParams({ measurement, field, range });
    if (tag) params.set('tag', tag);
    return fetch(`/api/history?${params}`).then(r => r.json());
  },

  poll: (intervalMs: number, callback: () => void): number => {
    const id = ++pollCounter;
    const handle = setInterval(callback, intervalMs);
    activePolls.set(id, handle);
    // Associate with the current sensor
    const name = (window as any).__pisenseCurrentSensor__;
    if (name) {
      if (!sensorPolls.has(name)) sensorPolls.set(name, []);
      sensorPolls.get(name)!.push(id);
    }
    return id;
  },

  stopPoll: (id: number): void => {
    const handle = activePolls.get(id);
    if (handle) {
      clearInterval(handle);
      activePolls.delete(id);
    }
  },

  // ── Internal: track window event listeners for automatic cleanup ──
  trackListener: (sensorName: string, type: string, listener: EventListenerOrEventListenerObject, opts: any): void => {
    const entry = loadedSensors.get(sensorName);
    if (entry) {
      entry.listenerCleanups.push(() => {
        window.removeEventListener(type, listener, opts);
      });
    }
  },

  // ── Internal: track setInterval/setTimeout IDs for automatic cleanup ──
  trackTimer: (sensorName: string, id: number): void => {
    const entry = loadedSensors.get(sensorName);
    if (entry) {
      entry.timerIds.push(id);
    }
  },

  onMount: (callback: () => void): void => {
    const name = (window as any).__pisenseCurrentSensor__;
    if (name) {
      if (!mountCallbacks.has(name)) mountCallbacks.set(name, []);
      mountCallbacks.get(name)!.push(callback);
    }
    callback();
  },

  onUnmount: (callback: () => void): void => {
    const name = (window as any).__pisenseCurrentSensor__;
    if (name) {
      if (!unmountCallbacks.has(name)) unmountCallbacks.set(name, []);
      unmountCallbacks.get(name)!.push(callback);
    }
  },
};

// ── Initial Load ──
async function init() {
  try {
    const res = await fetch('/api/sensors');
    if (!res.ok) return;
    const sensors: string[] = await res.json();
    for (const name of sensors) {
      await loadSensor(name);
    }
  } catch {
    // Server not ready yet or no API
  }

  // Status check
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const status = await res.json();
      updateStatus(status.influxdb, status.mqtt);
    } else {
      updateStatus('down', 'down');
    }
  } catch {
    updateStatus('down', 'down');
  }
}

init();

// ── WebSocket ──
let ws: WebSocket | null = null;

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'sensor-added') {
      loadSensor(msg.name);
    } else if (msg.type === 'sensor-removed') {
      unmountSensor(msg.name);
    } else if (msg.type === 'sensor-updated') {
      unmountSensor(msg.name);
      loadSensor(msg.name);
    } else if (msg.type === 'status') {
      updateStatus(msg.influxdb, msg.mqtt);
    }
  });

  ws.addEventListener('close', () => {
    setTimeout(connectWS, 3000);
  });
}

connectWS();
