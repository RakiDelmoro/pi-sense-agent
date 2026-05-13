---
name: dashboard-owner
description: Build sensors for the PiSense Dashboard — create sensor.html, sensor.css, sensor.ts, register pipeline entries, and validate. A sensor can be any visual the user needs: a gauge, a table, a map, a status panel, an animation, or anything else. Use when creating or modifying dashboard sensors.
---

# Dashboard Owner

## Structure

Every sensor lives in `sensors/<name>/` with exactly three files:

- `sensor.html` — visual markup (fragment only, no `<html>/<head>/<body>/<script>/<style>`)
- `sensor.css` — scoped styles (see rules below)
- `sensor.ts` — logic using the `pisense` API (see below)

**Naming:** lowercase, hyphenated, no spaces (e.g. `room-temp`, `cpu-load`)

### CSS

- **Scope all selectors** with `.sensor-card--<name>` — CSS is injected globally, unscoped rules leak to other sensors
- Match the dashboard aesthetic: dark theme, `'Press Start 2P', monospace` font, no border-radius, no gradients, small font sizes (0.5rem–0.8rem)
- Use CSS custom properties: `--bg (#0a0a0a)`, `--surface (#141414)`, `--border (#1e1e1e)`, `--text (#ffffff)`, `--text-dim (#888888)`, `--accent (#00e5ff)`, `--danger (#ff4444)`

### TypeScript

- Clean up all polls/intervals/timeouts in `pisense.onUnmount()` — every `pisense.poll()` must have a matching `pisense.stopPoll()`
- Use `pisense` API for data — no hardcoded or mock values
- Handle missing data: check for `undefined`/`null`, show `--` as fallback, no `console.log` in production

### General

- Always register a pipeline entry in `pipeline.json` — without it, no data flows
- No external dependencies — only vanilla HTML/CSS/TS and the `pisense` API
- Ask before assuming — if the MQTT topic, measurement, or field names are unknown, ask the user
- If the visual type is ambiguous, offer 2–3 options and ask; if specific, just build it

## `pisense` API

Injected as `window.pisense` before your script runs.

| Method | Signature | Description |
|--------|-----------|-------------|
| `query` | `(flux: string) => Promise<any>` | Raw Flux query against InfluxDB |
| `latest` | `(measurement, field, tag?) => Promise<any>` | Latest data point |
| `history` | `(measurement, field, range, tag?) => Promise<any>` | Data over a time range (e.g. `"-1h"`, `"-24h"`) |
| `poll` | `(intervalMs, callback) => number` | Repeating timer, returns poll ID |
| `stopPoll` | `(id) => void` | Stop a poll by ID |
| `onMount` | `(callback) => void` | Fires when sensor loads |
| `onUnmount` | `(callback) => void` | Fires on removal — use for cleanup |

**Response shapes:**

```json
// latest
{ "value": 22.5, "time": "2025-01-15T10:30:00Z" }

// history
{ "values": [{ "time": "...", "value": 22.1 }, { "time": "...", "value": 22.5 }] }
```

## Pipeline Registration

> The MQTT broker is configured globally via the `MQTT_BROKER` environment variable (same pattern as `INFLUX_URL`). Do **not** include a `mqtt_broker` field in pipeline entries.

Add a subscription to `pipeline.json` for MQTT→InfluxDB data flow:

```json
{
  "sensor": "room-temp",
  "mqtt_topic": "sensors/room/temp",
  "measurement": "temperature",
  "tags": { "location": "room1" },
  "fields": { "value": "float" },
  "data_format": "json"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `sensor` | ✅ | Must match `sensors/` folder name |
| `mqtt_topic` | ✅ | MQTT topic to subscribe to |
| `measurement` | ✅ | InfluxDB measurement name |
| `tags` | ❌ | Tags for each data point (key-value) |
| `fields` | ✅ | Field names and types (`float`, `int`, `string`) |
| `data_format` | ✅ | `json` (`{"value": 22.5}`), `value` (plain `22.5`), or `csv` (positional) |

### Self-Contained Sensors

> **⚠️ Never modify files that require `docker compose build`.** Only `sensors/` and `pipeline.json` are mounted as volumes — changes there are live. All other files (`server.ts`, `public/`, `package.json`, `bun.lock`, `Dockerfile`, `docker-compose.yml`, `mosquitto.conf`) are baked into the image. Editing them requires a rebuild to take effect.

The server stores all declared fields at arrival time with no behavioral logic. Any sensor-specific data transformation is handled in `sensor.ts`:

- **Backdated timestamps** — If the MQTT payload includes an offset field (e.g.
  `time_ms`), declare it as a regular field in `pipeline.json`:
  ```json
  "fields": { "value": "float", "time_ms": "int" }
  ```
  Then in `sensor.ts`, fetch **both** fields via `pisense.history()`:
  ```ts
  const values = await pisense.history('test', 'value', '-1h');
  const offsets = await pisense.history('test', 'time_ms', '-1h');
  // Join by shared _time, compute actualTime = storedTime - offsetMs
  ```
  Use `actualTime` for chart labels and tooltip display.
## Validation (mandatory)

After creating a sensor, run:

```bash
bun run validate <sensor-name>
```

This checks: TypeScript compiles, CSS parses, HTML is a fragment, pipeline entry exists, all 3 files present, CSS is scoped.

Loop until it passes — only then is the sensor complete.
