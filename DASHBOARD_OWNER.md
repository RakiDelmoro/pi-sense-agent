---
name: dashboard-owner
description: Build sensors for the PiSense Dashboard. A sensor is `sensors/<name>/` with sensor.html, sensor.css, sensor.ts. Use when creating or modifying sensors.
---

# Dashboard Owner

## Sensor Structure

`sensors/<name>/` — exactly 3 files (lowercase, hyphenated names):

- **sensor.html** — fragment only (no `<html>/<head>/<body>/<script>/<style>`)
- **sensor.css** — scoped with `.sensor-card--<name>`, use CSS vars: `--bg`, `--surface`, `--border`, `--text`, `--text-dim`, `--accent`, `--danger`, `--success`. Font: `var(--sensor-font)`. Support light theme via `[data-theme="light"]`.
- **sensor.ts** — use `pisense` API. Clean up in `onUnmount()`. Handle `null`/`undefined`. No external deps, no mock data.

### onMount Pattern (required)

**Always fetch data in `onMount` before the first render** — never render with null/empty state and wait for a poll. This prevents the "NO DATA" flash on page refresh:

```ts
ps.onMount(async () => {
  // Fetch data FIRST
  try {
    const data = await ps.latest(measurement, field);
    if (data && data.value !== undefined) {
      currentValue = Number(data.value);
      lastSeen = new Date();
    }
  } catch { /* first load may have no data yet */ }
  render(); // Render AFTER fetch

  // Then start polling
  const pollId = ps.poll(5000, async () => { ... });
  ps.trackTimer(name, pollId);
});
```

Key rules:
- `onMount` must be `async` — use `await` to fetch data before calling `render()`
- Poll intervals start *after* the initial fetch — they don't replace it
- This pattern applies to every sensor that displays data (gauges, charts, status panels, etc.)

## `pisense` API

### Data

| Method | Signature | Notes |
|--------|-----------|-------|
| `query` | `(flux) => Promise<any>` | Raw Flux |
| `latest` | `(measurement, field, tag?) => Promise<any>` | `{ value, time }` |
| `history` | `(measurement, field, range, tag?, opts?) => Promise<any>` | `{ values: [{time,value,field}] }` |
| `stats` | `(measurement, field, range, tag?) => Promise<any>` | `{ min,max,mean,count,first,last }` |
| `export` | `(measurement, field, range, tag?, opts?) => string` | Returns download URL |

**`history` opts:** `{ aggregate?: string, fn?: string, fill?: string, start?: string, stop?: string, fields?: string }`
- `aggregate`: `"2h"`, `"3d"`, etc. `fn`: `"mean"` (default), `"max"`, `"min"`, `"last"`, `"median"`, `"sum"`, `"count"`
- `fill`: `"none"` (default), `"null"`, `"previous"`
- `start`/`stop`: ISO 8601 — overrides `range`
- `fields`: comma-separated multi-field query (e.g. `"temp,humidity"`)

```ts
// Year-long chart (~122 points)
pisense.history("test","value","-365d",null,{aggregate:"3d",fn:"mean"})
// Custom window
pisense.history("test","value","-1h",null,{start:"2024-06-01T00:00:00Z",stop:"2024-06-15T00:00:00Z",aggregate:"4h"})
// Gap fill
pisense.history("test","value","-7d",null,{aggregate:"2h",fill:"previous"})
```

### MQTT & Devices

| Method | Signature | Notes |
|--------|-----------|-------|
| `publish` | `(topic, payload, retain?) => Promise` | WS-first, REST fallback |
| `onTopic` | `(topic, callback) => void` | Subscribe to MQTT topic, callback receives payload string |
| `topics` | `() => Promise<any>` | `{ subscribed, seen }` |
| `devices` | `() => Promise<any>` | `{ topic: {online,lastSeen} }` |

### Store (persistence)

| Method | Signature |
|--------|-----------|
| `store.get` | `(key) => Promise<any>` |
| `store.set` | `(key, value) => Promise<any>` |
| `store.delete` | `(key) => Promise<any>` |
| `store.list` | `() => Promise<any>` |

```ts
await pisense.store.set("sensor/test",{range:"7d",showChart:true});
const cfg = await pisense.store.get("sensor/test");
```

### Alerts

| Method | Signature |
|--------|-----------|
| `alerts.list` | `() => Promise<any>` |
| `alerts.create` | `(rule) => Promise<any>` |
| `alerts.update` | `(id, rule) => Promise<any>` |
| `alerts.delete` | `(id) => Promise<any>` |
| `alerts.history` | `() => Promise<any>` |

Rule: `{ id, name, measurement, field, condition:"above"|"below"|"equal", threshold, enabled, webhook?, cooldown? }`. Webhooks to **local LAN only**.

```ts
await pisense.alerts.create({name:"High Temp",measurement:"room",field:"temperature",condition:"above",threshold:80,enabled:true});
```

### Files

| Method | Signature |
|--------|-----------|
| `upload` | `(formData) => Promise<{ok,name,url}>` |
| `files.list` | `() => Promise<{files}>` |
| `files.get` | `(name) => string` (URL) |
| `files.delete` | `(name) => Promise<any>` |

### InfluxDB Admin

`influx(path, opts?) => Promise<any>` — proxy to InfluxDB v2 API. E.g. `pisense.influx("api/v2/buckets")`

### Auth

`auth.login(password)`, `auth.status()`, `auth.logout()`. Disabled by default. Enable: `pisense.store.set("auth-config",{enabled:true,password:"..."})`

### WebSocket Events

`onWs(type, callback)`, `offWs(type, callback)`

| Type | When |
|------|------|
| `mqtt-message` | MQTT message: `{topic,payload}` |
| `device-status` | Device online/offline: `{topic,online,lastSeen}` |
| `alert-triggered` | Alert fired: `{rule,value,time}` |
| `store-changed` | Store key updated: `{key}` |
| `status` | Service: `{influxdb,mqtt}` |

### Lifecycle

`poll(ms, fn) => id`, `stopPoll(id)`, `onMount(fn)`, `onUnmount(fn)`

## Pipeline

Register in `pipeline.json` for MQTT→InfluxDB:

```json
{"sensor":"room-temp","mqtt_topic":"sensors/room/temp","measurement":"temperature","tags":{"location":"room1"},"fields":{"value":"float"},"data_format":"json"}
```

`data_format`: `"json"` (`{"value":22.5}`), `"value"` (plain `22.5`), `"csv"` (positional). No `mqtt_broker` field — configured via env.

**In sensor.ts, use `pisense.onTopic()` to receive live MQTT messages:**

```ts
ps.onTopic("sensors/room/temp", (payload: string) => {
  const value = parseFloat(payload);
  if (!isNaN(value)) renderGauge(value);
});
```

Do NOT use `onWs()` directly for MQTT — `onTopic()` handles the WebSocket subscription message and correct event type for you.

## Self-Contained Sensors

> **⚠️ Only edit `sensors/` and `pipeline.json`** — they're volume-mounted (live reload). Everything else (`src/server/`, `src/public/`, `Dockerfile`, `docker-compose.yml`) requires `docker compose build`. The API is feature-complete — any feature can be built in sensor.ts.

**Data transforms happen in sensor.ts, not server:**
- Raw→display: `display = ((raw - RAW_MIN) / (RAW_MAX - RAW_MIN)) * 100`
- Backdated timestamps: declare offset field in pipeline, join in sensor.ts

## Dashboard UI Zones

| Zone | Activate |
|------|----------|
| Theme toggle | Click moon icon in header |
| Search | Click search icon |
| Settings | Click gear icon |
| Notifications | Auto-populates on alerts |
| Sidebar | `store.set("dashboard-config",{sidebar:{items:[{label,id}],position:"left"}})` |
| Tabs | `store.set("dashboard-config",{tabs:["Home","Sensors"]})` |
| Fullscreen card | Class `sensor-card--fullscreen` |
| Card sizes | Classes `--size-2x`, `--size-2y`, `--size-2x2` |

## Security

No outbound internet. No proxy. No email/push. Webhooks to local LAN only. Auth disabled by default (enable via store). Store keys validated against path traversal.

## Validation

```bash
bun run scripts/validate-sensor.ts <sensor-name>
```

Loop until it passes — only then is the sensor complete.
