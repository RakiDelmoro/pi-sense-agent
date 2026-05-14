import { onWs, offWs, getWs } from "./ws";

(window as any).pisense = {
  // ── Data queries ──
  query: (flux: string) =>
    fetch(`/api/query?flux=${encodeURIComponent(flux)}`).then(r => r.json()),

  latest: (measurement: string, field: string, tag?: string) => {
    const params = new URLSearchParams({ measurement, field });
    if (tag) params.set('tag', tag);
    return fetch(`/api/latest?${params}`).then(r => r.json());
  },

  history: (measurement: string, field: string, range: string, tag?: string, opts?: { aggregate?: string; fn?: string; fill?: string; start?: string; stop?: string; fields?: string }) => {
    const params = new URLSearchParams({ measurement, field, range });
    if (tag) params.set('tag', tag);
    if (opts?.aggregate) params.set('aggregate', opts.aggregate);
    if (opts?.fn) params.set('fn', opts.fn);
    if (opts?.fill && opts.fill !== 'none') params.set('fill', opts.fill);
    if (opts?.start) params.set('start', opts.start);
    if (opts?.stop) params.set('stop', opts.stop);
    if (opts?.fields) params.set('fields', opts.fields);
    return fetch(`/api/history?${params}`).then(r => r.json());
  },

  stats: (measurement: string, field: string, range: string, tag?: string) => {
    const params = new URLSearchParams({ measurement, field, range });
    if (tag) params.set('tag', tag);
    return fetch(`/api/stats?${params}`).then(r => r.json());
  },

  export: (measurement: string, field: string, range: string, tag?: string, opts?: { aggregate?: string; fn?: string; fill?: string; format?: string }) => {
    const params = new URLSearchParams({ measurement, field, range });
    if (tag) params.set('tag', tag);
    if (opts?.aggregate) params.set('aggregate', opts.aggregate);
    if (opts?.fn) params.set('fn', opts.fn);
    if (opts?.fill && opts.fill !== 'none') params.set('fill', opts.fill);
    if (opts?.format && opts.format !== 'csv') params.set('format', opts.format);
    return `/api/export?${params}`;
  },

  // ── MQTT ──
  publish: (topic: string, payload: string | number | boolean, retain?: boolean): Promise<any> => {
    const ws = getWs();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'publish', topic, payload: String(payload), retain: retain ?? false }));
      return Promise.resolve({ ok: true });
    }
    return fetch('/api/mqtt/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, payload: String(payload), retain: retain ?? false }),
    }).then(r => r.json());
  },

  topics: () => fetch('/api/mqtt/topics').then(r => r.json()),

  // ── MQTT subscribe ──
  onTopic: (topic: string, callback: (payload: string) => void): void => {
    const trySubscribe = () => {
      const w = getWs();
      if (w?.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: 'subscribe', topic }));
      } else {
        setTimeout(trySubscribe, 500);
      }
    };
    trySubscribe();

    onWs('mqtt-message', (msg: any) => {
      if (msg.topic === topic) callback(msg.payload);
    });
  },

  // ── Devices ──
  devices: () => fetch('/api/devices').then(r => r.json()),

  // ── Store ──
  store: {
    get: (key: string) => fetch(`/api/store/${encodeURIComponent(key)}`).then(r => r.json()),
    set: (key: string, value: any) => fetch(`/api/store/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    }).then(r => r.json()),
    delete: (key: string) => fetch(`/api/store/${encodeURIComponent(key)}`, { method: 'DELETE' }).then(r => r.json()),
    list: () => fetch('/api/store').then(r => r.json()),
  },

  // ── Alerts ──
  alerts: {
    list: () => fetch('/api/alerts').then(r => r.json()),
    create: (rule: any) => fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) }).then(r => r.json()),
    update: (id: string, rule: any) => fetch(`/api/alerts/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) }).then(r => r.json()),
    delete: (id: string) => fetch(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.json()),
    history: () => fetch('/api/alerts/history').then(r => r.json()),
  },

  // ── Files ──
  upload: (formData: FormData) => fetch('/api/upload', { method: 'POST', body: formData }).then(r => r.json()),
  files: {
    list: () => fetch('/api/files').then(r => r.json()),
    get: (name: string) => `/api/files/${encodeURIComponent(name)}`,
    delete: (name: string) => fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json()),
  },

  // ── InfluxDB admin ──
  influx: (path: string, opts?: RequestInit) => {
    return fetch(`/api/influx/${path}`, opts).then(r => {
      const ct = r.headers.get('content-type');
      if (ct && ct.includes('application/json')) return r.json();
      return r.text();
    });
  },

  // ── Auth ──
  auth: {
    login: (password: string) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }).then(r => r.json()),
    status: () => fetch('/api/auth/status').then(r => r.json()),
    logout: () => fetch('/api/auth/logout', { method: 'POST' }).then(r => r.json()),
  },

  // ── WS events ──
  onWs,
  offWs,

  // ── Polling ──
  poll: (intervalMs: number, callback: () => void): number => {
    const id = ++pollCounter;
    const handle = setInterval(callback, intervalMs);
    activePolls.set(id, handle);
    const name = (window as any).__pisenseCurrentSensor__;
    if (name) {
      if (!sensorPolls.has(name)) sensorPolls.set(name, []);
      sensorPolls.get(name)!.push(id);
    }
    return id;
  },

  stopPoll: (id: number): void => {
    const handle = activePolls.get(id);
    if (handle) { clearInterval(handle); activePolls.delete(id); }
  },

  // ── Internal ──
  trackListener: (sensorName: string, type: string, listener: EventListenerOrEventListenerObject, opts: any): void => {
    const entry = loadedSensors.get(sensorName);
    if (entry) entry.listenerCleanups.push(() => { window.removeEventListener(type, listener, opts); });
  },

  trackTimer: (sensorName: string, id: number): void => {
    const entry = loadedSensors.get(sensorName);
    if (entry) entry.timerIds.push(id);
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

// ── Poll tracking (used by pisense.poll) ──
let pollCounter = 0;
const activePolls = new Map<number, ReturnType<typeof setInterval>>();
const sensorPolls = new Map<string, number[]>();

// ── Sensor lifecycle tracking (used by sensor-loader) ──
const mountCallbacks = new Map<string, (() => void)[]>();
const unmountCallbacks = new Map<string, (() => void)[]>();
const loadedSensors = new Map<string, { container: HTMLElement; style: HTMLElement; listenerCleanups: (() => void)[]; timerIds: number[] }>();

export { mountCallbacks, unmountCallbacks, loadedSensors, activePolls, sensorPolls };
