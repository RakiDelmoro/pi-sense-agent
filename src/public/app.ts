import { onWs } from "./ws";
import { loadSensor, unmountSensor } from "./sensor-loader";
import { initSearch, initTheme, initSettings, initNotifications, pushNotification, loadDashboardConfig } from "./dashboard";

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
    promptEl.innerHTML = `<span class="prompt-arrow">&gt; </span>${visible}<span class="prompt-cursor">█</span>`;
    if (charIndex < current.length) {
      setTimeout(typePrompt, 40 + Math.random() * 40);
    } else {
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

// ── Empty State ──
const emptyState = document.getElementById('empty-state') as HTMLElement;
const sensorGrid = document.getElementById('sensor-grid') as HTMLElement;

function updateEmptyState() {
  if (sensorGrid.children.length === 0) emptyState.classList.remove('empty-state--hidden');
  else emptyState.classList.add('empty-state--hidden');
}

// ── Status ──
const statusInflux = document.getElementById('status-influxdb') as HTMLElement;
const statusMqtt = document.getElementById('status-mqtt') as HTMLElement;

function updateStatus(influxdb: 'ok' | 'down', mqtt: 'ok' | 'down') {
  if (influxdb === 'ok') statusInflux.classList.add('status-dot--ok');
  else statusInflux.classList.remove('status-dot--ok');
  if (mqtt === 'ok') statusMqtt.classList.add('status-dot--ok');
  else statusMqtt.classList.remove('status-dot--ok');
}

// ── Remove Modal ──
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
    .then(res => { if (!res.ok) throw new Error('Delete failed'); unmountSensor(name); updateEmptyState(); })
    .catch(err => console.error('Failed to remove sensor:', err));
});

// ── Init dashboard UI ──
initSearch(sensorGrid);
initTheme();
initSettings();
initNotifications();

// ── Init load ──
async function init() {
  try {
    const res = await fetch('/api/sensors');
    if (!res.ok) return;
    const sensors: string[] = await res.json();
    for (const name of sensors) await loadSensor(name, sensorGrid, showRemoveModal);
  } catch { /* server not ready */ }

  try {
    const res = await fetch('/api/status');
    if (res.ok) { const s = await res.json(); updateStatus(s.influxdb, s.mqtt); }
    else updateStatus('down', 'down');
  } catch { updateStatus('down', 'down'); }

  loadDashboardConfig();
  updateEmptyState();
}

init();

// ── WebSocket events ──
onWs('sensor-added', (msg: any) => { loadSensor(msg.name, sensorGrid, showRemoveModal).then(updateEmptyState); });
onWs('sensor-removed', (msg: any) => {
  fetch('/api/sensors').then(r => r.ok ? r.json() : []).then((names: string[]) => {
    if (!names.includes(msg.name)) { unmountSensor(msg.name); updateEmptyState(); }
  }).catch(() => { unmountSensor(msg.name); updateEmptyState(); });
});
onWs('sensor-updated', (msg: any) => {
  if (document.querySelector(`[data-sensor="${msg.name}"]`)) window.dispatchEvent(new Event('resize'));
  else loadSensor(msg.name, sensorGrid, showRemoveModal).then(updateEmptyState);
});
onWs('status', (msg: any) => updateStatus(msg.influxdb, msg.mqtt));
onWs('alert-triggered', (msg: any) => pushNotification(msg));
