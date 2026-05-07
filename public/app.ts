// ── Cycling Prompts ──
const prompts = [
  'Add a temperature gauge on topic sensors/room/temp',
  'Show humidity as a bar chart, alerts above 70%',
  'Monitor CPU load with a line graph',
  'Track pressure in kPa, refresh every 3s',
  'Create a motion detector, red when active',
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

// ── Status Indicators ──
const statusInflux = document.getElementById('status-influx') as HTMLElement;
const statusMqtt = document.getElementById('status-mqtt') as HTMLElement;

function updateStatus(influxdb: 'ok' | 'down', mqtt: 'ok' | 'down') {
  statusInflux.className = 'status__indicator' + (influxdb === 'ok' ? ' status__indicator--ok' : '');
  statusMqtt.className = 'status__indicator' + (mqtt === 'ok' ? ' status__indicator--ok' : '');
}

// ── Remove Confirmation Modal ──
const modal = document.getElementById('confirm-modal') as HTMLElement;
const modalText = document.getElementById('modal-text') as HTMLElement;
const modalConfirm = document.getElementById('modal-confirm') as HTMLButtonElement;
const modalCancel = document.getElementById('modal-cancel') as HTMLButtonElement;

let pendingRemoveName: string | null = null;

function showRemoveModal(name: string) {
  pendingRemoveName = name;
  modalText.textContent = `Remove sensor "${name}"?`;
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
const loadedSensors = new Map<string, { container: HTMLElement; style: HTMLElement }>();

async function loadSensor(name: string) {
  const [htmlRes, cssRes, tsRes] = await Promise.all([
    fetch(`/api/sensors/${name}/sensor.html`),
    fetch(`/api/sensors/${name}/sensor.css`),
    fetch(`/api/sensors/${name}/sensor.ts`),
  ]);

  if (!htmlRes.ok || !cssRes.ok || !tsRes.ok) {
    console.error(`Failed to load sensor: ${name}`);
    return;
  }

  const html = await htmlRes.text();
  const css = await cssRes.text();
  const ts = await tsRes.text();

  // Container
  const container = document.createElement('div');
  container.className = `sensor-card sensor-card--${name}`;
  container.innerHTML = html;

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'sensor-card__remove';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => showRemoveModal(name));
  container.appendChild(removeBtn);

  // Scoped CSS
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // Mount
  sensorGrid.appendChild(container);

  // Execute sensor TS
  const script = document.createElement('script');
  script.textContent = ts;
  document.body.appendChild(script);

  loadedSensors.set(name, { container, style });
  updateEmptyState();
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
    activePolls.set(id, setInterval(callback, intervalMs));
    return id;
  },

  stopPoll: (id: number): void => {
    const handle = activePolls.get(id);
    if (handle) {
      clearInterval(handle);
      activePolls.delete(id);
    }
  },

  onMount: (callback: () => void): void => {
    // Associate with the most recently loaded sensor
    const lastName = [...loadedSensors.keys()].pop();
    if (lastName) {
      if (!mountCallbacks.has(lastName)) mountCallbacks.set(lastName, []);
      mountCallbacks.get(lastName)!.push(callback);
    }
    callback();
  },

  onUnmount: (callback: () => void): void => {
    const lastName = [...loadedSensors.keys()].pop();
    if (lastName) {
      if (!unmountCallbacks.has(lastName)) unmountCallbacks.set(lastName, []);
      unmountCallbacks.get(lastName)!.push(callback);
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
