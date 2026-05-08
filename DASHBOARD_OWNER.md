---
name: dashboard-owner
description: Build sensors for the PiSense Dashboard — create sensor.html, sensor.css, sensor.ts, register pipeline entries, and validate. A sensor can be any visual the user needs: a gauge, a table, a map, a status panel, an animation, or anything else. Use when creating or modifying dashboard sensors.
---

# Dashboard Owner

> This file is also registered as a Pi skill at `.pi/skills/dashboard-owner/SKILL.md`.
> Pi loads it automatically when you ask it to create or modify sensors.

Build sensors — visual components wired to MQTT data through InfluxDB.

## File Structure

Every sensor lives in `sensors/<name>/` with exactly three files:

- `sensor.html` — visual markup (fragment only, no `<html>/<head>/<body>/<script>/<style>`)
- `sensor.css` — scoped styles (see rules below)
- `sensor.ts` — logic using the `pisense` API (see below)

**Naming:** lowercase, hyphenated, no spaces (e.g. `room-temp`, `cpu-load`)

## Rules

### CSS

- **Scope all selectors** with `.sensor-card--<name>` — CSS is injected globally, unscoped rules leak to other sensors
- Match the dashboard aesthetic: dark theme, `'Press Start 2P', monospace` font, no border-radius, no gradients, small font sizes (0.5rem–0.8rem)
- Use CSS custom properties: `--bg (#0a0a0a)`, `--surface (#141414)`, `--border (#1e1e1e)`, `--text (#ffffff)`, `--text-dim (#888888)`, `--accent (#f0a500)`, `--danger (#ff4444)`

### TypeScript

- Clean up all polls/intervals/timeouts in `pisense.onUnmount()` — every `pisense.poll()` must have a matching `pisense.stopPoll()`
- Use `pisense` API for data — no hardcoded or mock values
- Handle missing data: check for `undefined`/`null`, show `--` as fallback, no `console.log` in production

### Last Seen Indicator (mandatory)

Every sensor shows how long since the last data was published. Cards are always fully visible — no dimming:

- **CSS:** no `opacity` dimming on the card — always fully visible. Add `.<name>__last-seen` style (margin-left: auto, font-size 0.4rem, color `var(--text-dim)`, letter-spacing 1px)
- **HTML:** include a `<span class="<name>__last-seen" id="<name>-last-seen">--</span>` in the header (after the name). Also include a `<span class="<name>__dot"></span>` status dot (6px, `var(--text-dim)` → `var(--accent)` on live)
- **TS:** track `lastDataTime: Date | null = null` and `lastDataKey: string | null = null`; on each successful poll, compare the data key (`value|time`) to detect genuinely new data; only then set `lastDataTime = new Date()` (client clock, not server). Compute relative time and update `lastSeenEl`. Show `--` when no data yet. Use a 1-second `setInterval` to tick the display. Clean up the interval in `onUnmount`. Keep `--live` class toggle for the dot color change only (not opacity)

Relative-time format:
- `< 60s` → `Xs ago`
- `≥ 60s, < 3600s` → `Xm ago` (rounded down)
- `≥ 3600s` → `Xh ago` (rounded down)

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

Add a subscription to `pipeline.json` for MQTT→InfluxDB data flow:

```json
{
  "sensor": "room-temp",
  "mqtt_topic": "sensors/room/temp",
  "mqtt_broker": "tcp://localhost:1883",
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
| `mqtt_broker` | ❌ | Broker address (default: `tcp://localhost:1883`) |
| `measurement` | ✅ | InfluxDB measurement name |
| `tags` | ❌ | Tags for each data point (key-value) |
| `fields` | ✅ | Field names and types (`float`, `int`, `string`) |
| `data_format` | ✅ | `json` (`{"value": 22.5}`), `value` (plain `22.5`), or `csv` (positional) |
| `time_offset_field` | ❌ | Field name (in the JSON payload) whose value (in ms) is subtracted from arrival time to compute the actual measurement timestamp. Data is backdated in InfluxDB so the history chart reflects when the measurement was truly taken, not when it arrived. |

## Reference Example

See `sensors/TEST/` for a working gauge sensor with all three files + pipeline entry. It demonstrates the last-seen indicator pattern.

## Validation (mandatory)

After creating a sensor, run:

```bash
bun run validate <sensor-name>
```

This checks: TypeScript compiles, CSS parses, HTML is a fragment, pipeline entry exists, all 3 files present, CSS is scoped, live transition implemented.

Loop until it passes — only then is the sensor complete.
