# PiSense Dashboard

A dark, retro-pixel dashboard for IoT sensors. Receives data over MQTT, stores it in InfluxDB, and displays real-time sensor cards in the browser.

## Architecture

```
Sensors (ESP32, Pi, scripts)
       │ MQTT publish
       ▼
  Mosquitto (:1883)
       │
       ▼
  Dashboard (Bun :3000) ──▶ InfluxDB (:8086)
       │                         │
       ▼                         ▼
  Browser UI              Store & query data
```

## Prerequisites

- [Bun](https://bun.sh/) (auto-installed by devcontainer)

## Getting Started

### Devcontainer (recommended)

Open this repo in VS Code with the Dev Containers extension. Bun is auto-installed — then run:

```bash
bun run setup   # Install InfluxDB, Mosquitto, dependencies, and create .env
bun run dev     # Start everything
```

Open http://localhost:3000 in your browser.

### Manual setup

```bash
bun run setup   # Install all dependencies + create .env
bun run dev     # Start InfluxDB, Mosquitto, and the dashboard
```

Press **Ctrl+C** to stop — the script cleans up all services on exit.

## Built-in Sensors

| Sensor | Widget | MQTT Topic | Description |
|--------|--------|------------|-------------|
| `TEST` | Gauge (0–100) | `test` | Single-value gauge, polls every 3s |

See `pipeline.json` for the full list of MQTT subscriptions.

## Testing MQTT

Publish a test value to the `test` topic (plain float, not JSON):

```bash
# Using mosquitto_pub
mosquitto_pub -h localhost -p 1883 -t "test" -m "42.5"

# Or use the built-in test publisher
MQTT_TOPIC=test bun run scripts/publish-test.ts
```

> **Note:** The `publish-test.ts` script sends JSON by default (`{"value": 22.5}`).
> Set `MQTT_TOPIC` to match your pipeline subscription.

## Creating Sensors

See `DASHBOARD_OWNER.md` for the full sensor-building guide. Quick summary:

1. Create `sensors/<name>/sensor.html`, `sensor.css`, `sensor.ts`
2. Add a pipeline entry to `pipeline.json`
3. Run `bun run validate <sensor-name>`

## Scripts

| Command | Description |
|---------|-------------|
| `bun run setup` | Install all dependencies + create `.env` (run once) |
| `bun run dev` | Start InfluxDB + Mosquitto + dashboard |
| `bun run validate <name>` | Validate a sensor's file structure |
| `bun run scripts/publish-test.ts` | Publish random test values to MQTT |
| `bash scripts/install-deps.sh` | Install InfluxDB + Mosquitto only |

## Configuration

All config lives in `.env`. Copy `.env.example` and fill in your values:

| Variable | Description |
|----------|-------------|
| `PORT` | Dashboard server port (default: `3000`) |
| `INFLUX_URL` | InfluxDB connection URL |
| `INFLUX_TOKEN` | InfluxDB auth token (**required**) |
| `INFLUX_ORG` | InfluxDB organization (default: `pisense`) |
| `INFLUX_BUCKET` | InfluxDB bucket (default: `sensors`) |
| `INFLUX_ADMIN_USERNAME` | InfluxDB initial admin username (first-run setup) |
| `INFLUX_ADMIN_PASSWORD` | InfluxDB initial admin password (**required for setup**) |
| `INFLUX_SETUP_TOKEN` | InfluxDB setup token (**required for setup**) |
| `MQTT_BROKER` | MQTT broker URL (default: `tcp://localhost:1883`) |
