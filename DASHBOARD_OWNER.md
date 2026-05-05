---
name: dashboard-owner
description: Build sensors for the PiSense Dashboard — create sensor.html, sensor.css, sensor.ts, register pipeline entries, and validate. Use when creating or modifying dashboard sensors.
---

# 🚗 Dashboard Owner Skill

You are the **dashboard owner**. You build sensors — visual gauges, charts, and indicators that live on the PiSense Dashboard.

Think of it like a car instrument panel: each sensor is a gauge, and you wire it up to real data coming in over MQTT through InfluxDB.

---

## The Metaphor

| Concept | What it means |
|---------|---------------|
| **Dashboard** | The car instrument panel — a dark, pixel-aesthetic grid where sensors live |
| **Sensor** | A single gauge/indicator — one card in the grid |
| **Builder** | You — you craft the HTML, CSS, and TS that make a sensor work |
| **Pipeline** | The MQTT→InfluxDB wiring that feeds data to your sensor |

---

## File Structure

Every sensor lives in its own folder under `sensors/` with **exactly** three files:

```
sensors/
└── <sensor-name>/
    ├── sensor.html    ← the gauge markup
    ├── sensor.css     ← scoped styles
    └── sensor.ts      ← logic using the pisense API
```

**Rules:**
- Sensor names must be lowercase, hyphenated, no spaces (e.g. `room-temp`, `cpu-load`, `motion-detector`)
- Always create all three files — no exceptions
- No subdirectories inside a sensor folder

---

## The `pisense` API

The dashboard injects `window.pisense` before your sensor script runs. Use it to fetch data and manage lifecycle.

| Method | Signature | Description |
|--------|-----------|-------------|
| `query` | `(flux: string) => Promise<any>` | Run a raw Flux query against InfluxDB |
| `latest` | `(measurement: string, field: string, tag?: string) => Promise<any>` | Get the latest data point |
| `history` | `(measurement: string, field: string, range: string, tag?: string) => Promise<any>` | Get data over a time range (e.g. `"-1h"`, `"-24h"`) |
| `poll` | `(intervalMs: number, callback: () => void) => number` | Set up a repeating timer. Returns a poll ID |
| `stopPoll` | `(id: number) => void` | Stop a poll by its ID |
| `onMount` | `(callback: () => void) => void` | Called when the sensor is loaded. Fires immediately |
| `onUnmount` | `(callback: () => void) => void` | Called when the sensor is removed. Use for cleanup |

### `latest` response shape

```json
{
  "value": 22.5,
  "time": "2025-01-15T10:30:00Z"
}
```

### `history` response shape

```json
{
  "values": [
    { "time": "2025-01-15T10:00:00Z", "value": 22.1 },
    { "time": "2025-01-15T10:30:00Z", "value": 22.5 }
  ]
}
```

### `query` response shape

Returns the raw InfluxDB JSON result. Structure depends on your Flux query.

---

## `sensor.html` Conventions

Your HTML is injected into a container with class `sensor-card sensor-card--<name>`.

- Keep it minimal — just the visual structure
- Use semantic class names prefixed with your sensor name
- No `<html>`, `<head>`, or `<body>` tags — you're building a fragment, not a page
- No `<script>` or `<style>` tags here — logic goes in `sensor.ts`, styles in `sensor.css`

Example:

```html
<div class="room-temp__gauge">
  <div class="room-temp__label">Room Temp</div>
  <div class="room-temp__value">--</div>
  <div class="room-temp__unit">°C</div>
</div>
```

---

## `sensor.css` Conventions

### Scoping (MANDATORY)

All CSS selectors **must** be scoped to your sensor card. The dashboard injects your CSS globally — without scoping you'll break other sensors.

**Always** wrap selectors with `.sensor-card--<name>`:

```css
/* ✅ Correct — scoped */
.sensor-card--room-temp .room-temp__gauge { ... }
.sensor-card--room-temp .room-temp__value { ... }

/* ❌ Wrong — unscoped, will leak */
.gauge { ... }
.value { ... }
```

### Aesthetic (match the dashboard)

The dashboard uses a dark, retro-pixel aesthetic. Match it:

| Variable | Value | Use for |
|----------|-------|---------|
| `--bg` | `#0a0a0a` | Deepest background |
| `--surface` | `#111111` | Card / panel backgrounds |
| `--border` | `#2a2a2a` | Borders, dividers |
| `--text` | `#c8c8c8` | Primary text |
| `--text-dim` | `#555555` | Secondary / dimmed text |
| `--accent` | `#4a9eff` | Highlights, active states |
| `--danger` | `#ff4444` | Alerts, errors, remove buttons |

**Rules:**
- Use CSS custom properties from the dashboard where possible (e.g. `color: var(--text)`)
- Font: `'Press Start 2P', monospace` — already loaded by the dashboard
- **No border-radius** — pixel aesthetic uses sharp corners
- **No gradients or shadows** — flat and clean
- Small font sizes (0.5rem–0.8rem) — the pixel font is large for its size
- Use `image-rendering: pixelated` for any images

---

## `sensor.ts` Conventions

Your TypeScript runs in the browser after your HTML and CSS are injected.

### Structure

```typescript
// 1. Grab DOM elements from your sensor.html
const value = document.querySelector('.room-temp__value') as HTMLElement;
const card = document.querySelector('.sensor-card--room-temp') as HTMLElement;
let hasData = false;

// 2. Define update function
async function update() {
  try {
    const data = await pisense.latest('temperature', 'value', 'location=room1');
    if (data && data.value !== undefined) {
      value.textContent = data.value.toFixed(1);
      if (!hasData) {
        hasData = true;
        card.classList.add('sensor-card--room-temp--live');
      }
    }
  } catch {
    // InfluxDB may be temporarily unreachable
  }
}

// 3. Initial update + polling
let pollId: number | null = null;

pisense.onMount(() => {
  update();
  pollId = pisense.poll(3000, update);
});

// 4. Clean up on unmount (MANDATORY)
pisense.onUnmount(() => {
  if (pollId !== null) {
    pisense.stopPoll(pollId);
    pollId = null;
  }
});
```

### Rules

1. **Always clean up polls** — every `pisense.poll()` must have a matching `pisense.stopPoll()` in `onUnmount`
2. **Always clean up intervals/timeouts** — any `setInterval` or `setTimeout` you create must be cleared in `onUnmount`
3. **Use `pisense` API for data** — don't hardcode values or mock data
4. **Handle missing data gracefully** — check for `undefined`/`null` before rendering
5. **No `console.log` in production** — remove debug logging before finishing
6. **Implement waiting → live transition** — every sensor must start in a waiting state and transition to live on first data (see below)

---

## No-Data / Live States (MANDATORY)

When you create a sensor, the MQTT device usually isn't publishing yet. The sensor has **no data**. You must handle this explicitly — a dim, waiting sensor that lights up when data arrives.

### Two states

| State | When | Visual |
|-------|------|--------|
| **Waiting** | Sensor created, no data has ever been received | Card content dimmed (`opacity: 0.4`), values show `--`, small idle dot |
| **Live** | First successful data fetch returns a real value | Card at full brightness (`opacity: 1`), real values, accent-colored dot |

### How it works

1. **CSS**: Style the sensor's main content at `opacity: 0.4` by default. Add a `--live` modifier class that sets `opacity: 1` with a transition.
2. **TS**: Track a `hasData` boolean. On first successful data fetch, set `hasData = true` and add the `--live` class to the card container.
3. **HTML**: Include a small status dot in your markup that starts dim and turns accent-colored when live.

### CSS pattern

```css
/* Waiting state — dimmed by default */
.sensor-card--<name> .<name>__gauge {
  opacity: 0.4;
  transition: opacity 0.6s ease;
}

/* Live state — full brightness */
.sensor-card--<name>--live .<name>__gauge {
  opacity: 1;
}

/* Status dot */
.sensor-card--<name> .<name>__dot {
  width: 6px;
  height: 6px;
  background-color: var(--text-dim);
  display: inline-block;
  margin-right: 0.5rem;
  transition: background-color 0.6s ease;
}

.sensor-card--<name>--live .<name>__dot {
  background-color: var(--accent);
}
```

### TS pattern

```typescript
const card = document.querySelector('.sensor-card--<name>') as HTMLElement;
let hasData = false;

async function update() {
  try {
    const data = await pisense.latest('measurement', 'field', 'tag=value');
    if (data && data.value !== undefined) {
      valueEl.textContent = data.value.toFixed(1);
      if (!hasData) {
        hasData = true;
        card.classList.add('sensor-card--<name>--live');
      }
    }
  } catch {}
}
```

### Why

- **Zero new plumbing** — no server changes, no `pisense` API additions
- **Self-contained** — each sensor owns its own state transition
- **Graceful** — if a sensor doesn't implement it, it still works, just without the visual indicator
- **Matches the metaphor** — a car gauge that hasn't received a signal yet is dim; it lights up when the signal arrives

---

## Pipeline Registration

To receive MQTT data into InfluxDB, you must register a subscription in `pipeline.json`:

```json
{
  "subscriptions": [
    {
      "sensor": "room-temp",
      "mqtt_topic": "sensors/room/temp",
      "mqtt_broker": "tcp://localhost:1883",
      "measurement": "temperature",
      "tags": { "location": "room1" },
      "fields": { "value": "float" },
      "data_format": "json"
    }
  ]
}
```

### Field reference

| Field | Required | Description |
|-------|----------|-------------|
| `sensor` | ✅ | Must match the folder name in `sensors/` |
| `mqtt_topic` | ✅ | MQTT topic to subscribe to |
| `mqtt_broker` | ❌ | Broker address (default: `tcp://localhost:1883`) |
| `measurement` | ✅ | InfluxDB measurement name |
| `tags` | ❌ | Tags to attach to each data point (key-value pairs) |
| `fields` | ✅ | Field names and types (`float`, `int`, `string`) |
| `data_format` | ✅ | How to parse MQTT payload: `json`, `value`, or `csv` |

### Data formats

- **`json`** — payload is a JSON object. Field names map to keys: `{"value": 22.5}`
- **`value`** — payload is a single number: `22.5`. Stored in the first field defined in `fields`
- **`csv`** — payload is comma-separated values. Maps positionally to `fields` keys

**When creating a sensor, always add the pipeline entry.** Without it, no data flows.

---

## Example 1: Temperature Gauge

A simple numeric display that shows the current temperature, polled every 5 seconds.

### `sensors/room-temp/sensor.html`

```html
<div class="room-temp__gauge">
  <div class="room-temp__label"><span class="room-temp__dot"></span>Room Temp</div>
  <div class="room-temp__value">--</div>
  <div class="room-temp__unit">°C</div>
</div>
```

### `sensors/room-temp/sensor.css`

```css
.sensor-card--room-temp .room-temp__gauge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  min-height: 120px;
  opacity: 0.4;
  transition: opacity 0.6s ease;
}

.sensor-card--room-temp--live .room-temp__gauge {
  opacity: 1;
}

.sensor-card--room-temp .room-temp__label {
  font-size: 0.5rem;
  color: var(--text-dim);
  letter-spacing: 2px;
  margin-bottom: 0.75rem;
}

.sensor-card--room-temp .room-temp__dot {
  width: 6px;
  height: 6px;
  background-color: var(--text-dim);
  display: inline-block;
  margin-right: 0.5rem;
  transition: background-color 0.6s ease;
}

.sensor-card--room-temp--live .room-temp__dot {
  background-color: var(--accent);
}

.sensor-card--room-temp .room-temp__value {
  font-size: 1.4rem;
  color: var(--accent);
  letter-spacing: 1px;
}

.sensor-card--room-temp .room-temp__unit {
  font-size: 0.45rem;
  color: var(--text-dim);
  margin-top: 0.5rem;
}
```

### `sensors/room-temp/sensor.ts`

```typescript
const valueEl = document.querySelector('.room-temp__value') as HTMLElement;
const card = document.querySelector('.sensor-card--room-temp') as HTMLElement;
let hasData = false;

async function update() {
  try {
    const data = await pisense.latest('temperature', 'value', 'location=room1');
    if (data && data.value !== undefined) {
      valueEl.textContent = data.value.toFixed(1);
      if (!hasData) {
        hasData = true;
        card.classList.add('sensor-card--room-temp--live');
      }
    }
  } catch {
    // InfluxDB may be temporarily unreachable
  }
}

let pollId: number | null = null;

pisense.onMount(() => {
  update();
  pollId = pisense.poll(5000, update);
});

pisense.onUnmount(() => {
  if (pollId !== null) {
    pisense.stopPoll(pollId);
    pollId = null;
  }
});
```

### Pipeline entry (add to `pipeline.json` subscriptions array)

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

---

## Example 2: Humidity Bar Chart

A horizontal bar that fills based on humidity percentage, with an alert state above 70%.

### `sensors/humidity-bar/sensor.html`

```html
<div class="humidity-bar__container">
  <div class="humidity-bar__label"><span class="humidity-bar__dot"></span>Humidity</div>
  <div class="humidity-bar__track">
    <div class="humidity-bar__fill"></div>
  </div>
  <div class="humidity-bar__reading">
    <span class="humidity-bar__value">--</span>
    <span class="humidity-bar__unit">%</span>
  </div>
</div>
```

### `sensors/humidity-bar/sensor.css`

```css
.sensor-card--humidity-bar .humidity-bar__container {
  padding: 1.25rem;
  opacity: 0.4;
  transition: opacity 0.6s ease;
}

.sensor-card--humidity-bar--live .humidity-bar__container {
  opacity: 1;
}

.sensor-card--humidity-bar .humidity-bar__label {
  font-size: 0.5rem;
  color: var(--text-dim);
  letter-spacing: 2px;
  margin-bottom: 0.75rem;
}

.sensor-card--humidity-bar .humidity-bar__dot {
  width: 6px;
  height: 6px;
  background-color: var(--text-dim);
  display: inline-block;
  margin-right: 0.5rem;
  transition: background-color 0.6s ease;
}

.sensor-card--humidity-bar--live .humidity-bar__dot {
  background-color: var(--accent);
}

.sensor-card--humidity-bar .humidity-bar__track {
  background-color: var(--border);
  height: 12px;
  border: 1px solid var(--border);
  margin-bottom: 0.75rem;
}

.sensor-card--humidity-bar .humidity-bar__fill {
  height: 100%;
  width: 0%;
  background-color: var(--accent);
  transition: width 0.5s ease;
}

.sensor-card--humidity-bar .humidity-bar__fill--alert {
  background-color: var(--danger);
}

.sensor-card--humidity-bar .humidity-bar__reading {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.sensor-card--humidity-bar .humidity-bar__value {
  font-size: 1rem;
  color: var(--text);
}

.sensor-card--humidity-bar .humidity-bar__unit {
  font-size: 0.45rem;
  color: var(--text-dim);
}
```

### `sensors/humidity-bar/sensor.ts`

```typescript
const fillEl = document.querySelector('.humidity-bar__fill') as HTMLElement;
const valueEl = document.querySelector('.humidity-bar__value') as HTMLElement;
const card = document.querySelector('.sensor-card--humidity-bar') as HTMLElement;
let hasData = false;

async function update() {
  try {
    const data = await pisense.latest('humidity', 'value', 'location=room1');
    if (data && data.value !== undefined) {
      const pct = Math.min(100, Math.max(0, data.value));
      valueEl.textContent = pct.toFixed(0);
      fillEl.style.width = `${pct}%`;

      // Alert state above 70%
      if (pct > 70) {
        fillEl.classList.add('humidity-bar__fill--alert');
      } else {
        fillEl.classList.remove('humidity-bar__fill--alert');
      }

      // Transition to live on first data
      if (!hasData) {
        hasData = true;
        card.classList.add('sensor-card--humidity-bar--live');
      }
    }
  } catch {
    // InfluxDB may be temporarily unreachable
  }
}

let pollId: number | null = null;

pisense.onMount(() => {
  update();
  pollId = pisense.poll(3000, update);
});

pisense.onUnmount(() => {
  if (pollId !== null) {
    pisense.stopPoll(pollId);
    pollId = null;
  }
});
```

### Pipeline entry (add to `pipeline.json` subscriptions array)

```json
{
  "sensor": "humidity-bar",
  "mqtt_topic": "sensors/room/humidity",
  "measurement": "humidity",
  "tags": { "location": "room1" },
  "fields": { "value": "float" },
  "data_format": "json"
}
```

---

## Rules

1. **Scope your CSS** — always prefix selectors with `.sensor-card--<name>`
2. **Clean up on unmount** — stop all polls, clear all intervals/timeouts in `pisense.onUnmount`
3. **Match the aesthetic** — use dashboard CSS variables, Press Start 2P font, no border-radius, no gradients
4. **Always register the pipeline** — a sensor without a pipeline entry has no data
5. **Handle missing data** — check for `undefined`/`null` before rendering, show `--` as fallback
6. **No external dependencies** — only vanilla HTML/CSS/TS and the `pisense` API
7. **Ask before assuming** — if you don't know the MQTT topic, measurement name, or field names, ask
8. **Implement waiting → live transition** — every sensor must start dimmed (waiting) and light up (live) on first data. Include a status dot and the `--live` modifier class

---

## Validation (MANDATORY)

After creating a sensor, you **must** run both validation steps. Do not declare the task done until both pass.

### Step 1: Structural Validation

```bash
bun run scripts/validate-sensor.ts <sensor-name>
```

This checks:
- TypeScript compiles without errors
- CSS parses without errors
- HTML structure is valid
- `pipeline.json` entry exists and is well-formed
- All three files (`sensor.html`, `sensor.css`, `sensor.ts`) are present

### Step 2: Visual Validation

```bash
bun run scripts/screenshot-sensor.ts <sensor-name>
```

This uses Playwright to:
- Launch the dashboard
- Take a screenshot of the sensor card
- Save to `screenshots/<sensor-name>.png`
- Dump the rendered DOM for inspection

Open the screenshot and verify:
- The sensor renders correctly
- Text is readable
- Layout is not broken
- Colors match the dashboard aesthetic

### Validation Loop

If either step fails:
1. Read the error output
2. Fix the issue
3. Re-run both steps
4. Repeat until both pass

**Only after both steps pass** can you declare the sensor complete.
