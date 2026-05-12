# PiSense Dashboard

A dark, retro-pixel dashboard for IoT sensors — powered by [Pi](https://pi.dev/). Tell Pi what to sense, and it builds the sensor for you.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

That's it. Everything else runs in containers.

## Getting Started

1. **Create your .env file**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your AI API key for Pi:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. **Start the dashboard**
   ```bash
   docker compose up -d
   ```

   Open http://localhost:3000

3. **Chat with Pi** (to create sensors)
   ```bash
   docker compose run --rm pi
   ```

4. **Validate a sensor**
   ```bash
   docker compose run --rm pi bun run scripts/validate-sensor.ts <sensor-name>
   ```

5. **Stop everything** (data preserved in volumes)
   ```bash
   docker compose down
   ```

## Adding Sensors

Launch Pi:

```bash
docker compose run --rm pi
```

> **First time?** Pi needs an AI model configured. Set your API key in `.env` (e.g. `ANTHROPIC_API_KEY=sk-ant-...`).

First, learn the sensor builder skill — paste this:

```
Read DASHBOARD_OWNER.md and save it as a Pi skill at .pi/skills/dashboard-owner/SKILL.md
```

Now describe any sensor and Pi builds it:
- "Gauge sensor on topic room/temp, min 0 max 50"
- "History chart on topic server/cpu, range 0 to 100"
- "Status panel on topic door/entrance, show open or closed"

Pi builds HTML, CSS, TypeScript, and pipeline registration. The card appears on the dashboard automatically.

## Configuration

All config lives in `.env`. Copy `.env.example` and fill in your values:

| Variable | Description |
|----------|-------------|
| `PORT` | Dashboard server port (default: `3000`) |
| `INFLUX_URL` | InfluxDB connection URL (Docker: `http://influxdb:8086`) |
| `INFLUX_TOKEN` | InfluxDB auth token (**required**) |
| `INFLUX_ORG` | InfluxDB organization (default: `pisense`) |
| `INFLUX_BUCKET` | InfluxDB bucket (default: `sensors`) |
| `INFLUX_ADMIN_USERNAME` | InfluxDB initial admin username (first-run setup) |
| `INFLUX_ADMIN_PASSWORD` | InfluxDB initial admin password (**required for setup**) |
| `MQTT_BROKER` | MQTT broker URL (Docker: `mqtt://mosquitto:1883`) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Pi |
| `OPENAI_API_KEY` | OpenAI API key for Pi |
