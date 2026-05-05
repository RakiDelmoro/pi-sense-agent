# PiSense Dashboard — Full Implementation Plan

## Architecture

```
[Sensor Device]
      │
      ▼ MQTT
[MQTT Broker (Mosquitto)]
      │
      ▼ subscribe (pipeline.json driven)
[PiSense Server ─ MQTT→InfluxDB Pipeline]
      │
      ▼ write
[InfluxDB]
      │
      ▼ query (server proxies)
[PiSense Server ─ API + WebSocket]
      │
      ▼ hot-reload + data fetch
[PiSense Dashboard ─ renders sensors]
```

Three core subsystems:
1. **Pipeline** — reads `pipeline.json`, subscribes to MQTT topics, writes to InfluxDB
2. **Server** — serves dashboard, serves sensor files, proxies InfluxDB queries, pushes WebSocket events, watches `sensors/` for changes
3. **Dashboard** — loads sensors dynamically, provides `pisense` API to sensor scripts, handles remove confirmation, shows status indicators

---

## File Structure

```
pi-sense-agent/
├── package.json
├── tsconfig.json
├── server.ts                  # Bun server — API, WebSocket, static files, pipeline
├── pipeline.json              # MQTT→InfluxDB subscriptions (LLM edits this)
├── DASHBOARD_OWNER.md         # The brain — Pi skill file that teaches LLM how to build sensors
├── scripts/
│   ├── validate-sensor.ts     # Structural validation (TS compile, CSS, HTML, pipeline)
│   └── screenshot-sensor.ts   # Visual validation (Playwright screenshot + DOM dump)
├── screenshots/               # Auto-created, gitignored — visual validation output
├── sensors/                   # LLM-generated sensor folders
│   └── room-temp/
│       ├── car.html
│       ├── car.css
│       └── car.ts
├── public/
│   ├── index.html             # Dashboard shell
│   ├── styles.css             # Dashboard global styles
│   └── app.ts                 # Dashboard core — loads sensors, provides pisense API
```

---

## Server (server.ts)

### Static File Serving
- Serve `public/` at `/`
- Serve `sensors/<name>/car.html` at `GET /api/sensors/:name/car.html`
- Serve `sensors/<name>/car.css` at `GET /api/sensors/:name/car.css`
- Serve `sensors/<name>/car.ts` at `GET /api/sensors/:name/car.ts`

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sensors` | List all sensors (scan `sensors/` directory) |
| GET | `/api/sensors/:name/car.html` | Serve sensor HTML |
| GET | `/api/sensors/:name/car.css` | Serve sensor CSS |
| GET | `/api/sensors/:name/car.ts` | Serve sensor TS |
| DELETE | `/api/sensors/:name` | Remove sensor (delete folder + pipeline entry) |
| GET | `/api/query?flux=...` | Proxy Flux query to InfluxDB |
| GET | `/api/status` | Health check — returns `{influxdb: "ok"|"down", mqtt: "ok"|"down"}` |

### InfluxDB Proxy
- Server holds the InfluxDB token (never exposed to client)
- `GET /api/query?flux=...` → server runs query against InfluxDB → returns JSON result
- Helper endpoints that map to simpler queries:
  - `GET /api/latest?measurement=x&field=y&tag=k=v`
  - `GET /api/history?measurement=x&field=y&range=-1h&tag=k=v`

### WebSocket
- On client connect, send current sensor list
- Push events when `sensors/` directory changes:
  - `{type: "sensor-added", name: "room-temp"}`
  - `{type: "sensor-removed", name: "room-temp"}`
  - `{type: "sensor-updated", name: "room-temp"}`
- Push status events:
  - `{type: "status", influxdb: "ok"|"down", mqtt: "ok"|"down"}`

### File Watcher
- Watch `sensors/` directory with `fs.watch`
- On new folder / file change → push `sensor-added` or `sensor-updated`
- On folder removal → push `sensor-removed`

### MQTT→InfluxDB Pipeline
- On server boot, read `pipeline.json`
- For each subscription, connect to MQTT broker and subscribe to the topic
- On MQTT message, parse payload and write to InfluxDB using line protocol
- Watch `pipeline.json` for changes — on update, diff subscriptions and add/remove MQTT listeners
- If MQTT broker unreachable → set status to `mqtt: "down"`
- If InfluxDB unreachable → set status to `influxdb: "down"`

---

## Dashboard (public/app.ts)

### Sensor Loading
1. On page load, fetch `GET /api/sensors`
2. For each sensor, fetch its `car.html`, `car.css`, `car.ts`
3. Create a container div with class `sensor-card` + `sensor-card--<name>`
4. Inject CSS as a `<style>` tag (scoped by `.car-<name>`)
5. Inject HTML into the container
6. Load and execute the TS (Bun serves it as JS)
7. Call the sensor's `pisense.onMount` callbacks

### Grid Layout
- Sensors arrange in a responsive CSS grid
- `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))`
- Each sensor card: `border: 2px solid var(--border)`, `background: var(--surface)`
- No border-radius (pixel aesthetic)

### Sensor Removal
1. Each sensor card has a "✕" button in top-right corner
2. Click → show confirmation modal: "Remove <sensor-name>?"
3. Confirm → `DELETE /api/sensors/:name`
4. On success → run `pisense.onUnmount`, remove container + style + script
5. Cancel → close modal, no action

### `pisense` Global API
```typescript
window.pisense = {
  query: (flux: string) => fetch(`/api/query?flux=${encodeURIComponent(flux)}`).then(r => r.json()),
  latest: (measurement, field, tag?) => fetch(`/api/latest?measurement=${measurement}&field=${field}&tag=${tag}`).then(r => r.json()),
  history: (measurement, field, range, tag?) => fetch(`/api/history?measurement=${measurement}&field=${field}&range=${range}&tag=${tag}`).then(r => r.json()),
  poll: (intervalMs, callback) => { /* returns poll ID */ },
  stopPoll: (id) => { /* clearInterval */ },
  onMount: (callback) => { /* register per-sensor */ },
  onUnmount: (callback) => { /* register per-sensor */ },
};
```

### Hot-Reload
- Connect WebSocket on page load
- On `sensor-added` → fetch and inject new sensor
- On `sensor-removed` → unmount sensor
- On `sensor-updated` → unmount old, fetch and inject new
- On `status` → update indicator dots

### Status Indicators
- Fixed position in top-right of header (or below header)
- Two small dots:
  - 🟢/🔴 InfluxDB status
  - 🟢/🔴 MQTT status
- Pixel style — small square indicators, not circles
- Green = `ok`, Red = `down`
- Updated via WebSocket status events + periodic `GET /api/status` fallback (every 30s)

### Empty State (no sensors)
When no sensors are loaded, show a centered empty state:
- A short catchy welcome message at the top: **"Your sensors live here"**
- Below it, cycling example prompts — 5 prompts that rotate with a typing animation
- Each prompt appears one at a time, types in character by character, pauses, then fades out and the next one types in
- Example prompts:
  1. `> Add a temperature gauge on topic sensors/room/temp`
  2. `> Show humidity as a bar chart, alerts above 70%`
  3. `> Monitor CPU load with a line graph`
  4. `> Track pressure in kPa, refresh every 3s`
  5. `> Create a motion detector, red when active`
- Styling: pixel font, accent color for `>`, dim text for the prompt content
- When a sensor is added, the empty state hides and the sensor grid appears
- When all sensors are removed, the empty state returns

---

## Pipeline Config (pipeline.json)

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

- `sensor` — must match the folder name in `sensors/`
- `mqtt_topic` — topic to subscribe to
- `mqtt_broker` — broker address (default: `tcp://localhost:1883`)
- `measurement` — InfluxDB measurement name
- `tags` — tags to attach to each data point
- `fields` — field names and types (`float`, `int`, `string`)
- `data_format` — how to parse MQTT payload (`json`, `value`, `csv`)

Default `pipeline.json` on fresh install:
```json
{
  "subscriptions": []
}
```

---

## Pi Skill (DASHBOARD_OWNER.md)

This is the single `.md` brain file that Pi reads. It IS the skill — there is no separate skill file. It tells Pi how to act as the dashboard owner and build sensors. It contains:
- Metaphor explanation (dashboard, sensors, builder)
- File structure conventions
- Available `pisense` API reference
- car.html / car.css / car.ts conventions (scoping, aesthetic, lifecycle)
- Pipeline registration instructions (edit pipeline.json)
- Two complete examples (temperature gauge, humidity chart)
- Rules (scope CSS, clean up, match aesthetic, ask before assuming)

Full skill content is already drafted and ready for implementation.

---

## Implementation Phases

### Phase 1: Server + Dashboard Shell
- Rewrite `server.ts` with API routes, WebSocket, file watcher
- Update `public/index.html` with grid container, status indicators, confirmation modal, empty-state with cycling prompts
- Update `public/styles.css` with grid layout, sensor card shell, status indicators, modal, empty-state cycling animation
- Update `public/app.ts` with sensor loader, pisense API, WebSocket, removal flow, empty-state logic
- Create empty `pipeline.json`

### Phase 2: MQTT→InfluxDB Pipeline
- Add MQTT client dependency (`mqtt` npm package)
- Add InfluxDB write client to server
- Implement pipeline: read pipeline.json, subscribe, parse, write to InfluxDB
- Watch pipeline.json for live subscription updates
- Health checks for MQTT and InfluxDB

### Phase 3: The Brain File
- Create `DASHBOARD_OWNER.md` in project root
- Contains: metaphor, conventions, API reference, examples, rules, mandatory validation steps
- Test: tell Pi to create a sensor using this file → Pi generates files → validates → dashboard picks it up

### Phase 4: Validation Scripts
- Install Playwright (`bun add -d playwright`)
- Create `scripts/validate-sensor.ts` — structural checks (TS compile, CSS parse, HTML structure, pipeline.json)
- Create `scripts/screenshot-sensor.ts` — visual checks (Playwright screenshot + DOM dump to `screenshots/`)
- Create `screenshots/` directory (gitignored)
- Add validation rules to `DASHBOARD_OWNER.md` — mandatory Step 1 (structural) + Step 2 (visual) loop

---

## Validation Steps

1. Start server with empty `sensors/` → dashboard shows empty state, both status dots green
2. Manually create a test sensor in `sensors/test/` → dashboard hot-loads it
3. Remove test sensor via dashboard ✕ button → confirmation → sensor disappears
4. Stop InfluxDB → MQTT dot green, InfluxDB dot red
5. Stop Mosquitto → MQTT dot red, InfluxDB dot green
6. Tell Pi to create a sensor → Pi writes files + pipeline.json → sensor appears live
7. Pipeline receives MQTT message → writes to InfluxDB → sensor displays data

---

## Assumptions / Open Items

- MQTT broker is Mosquitto on `localhost:1883` (configurable in pipeline.json)
- InfluxDB is on `localhost:8086` with a pre-configured token, org, and bucket
- Bun natively transpiles TS for the client — no build step needed
- Only one MQTT broker supported initially
- Sensor names must be valid folder names (lowercase, hyphens, no spaces)
- No authentication on the dashboard itself (local network assumption)
