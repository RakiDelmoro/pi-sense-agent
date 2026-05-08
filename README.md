# PiSense Dashboard

A dark, retro-pixel dashboard for IoT sensors — powered by [Pi](https://pi.dev/). Tell Pi what to sense, and it builds the sensor for you.

## Prerequisites

- [Bun](https://bun.sh/) (auto-installed by devcontainer)
- [Pi](https://pi.dev/) (installed by `bun run setup`)

## Getting Started

```bash
bun run setup   # Install InfluxDB, Mosquitto, Pi, dependencies, and create .env
```

> **💡 Tip:** Edit `.env` now to set your InfluxDB credentials, org, and bucket. Onboarding runs once on first `bun run dev` — if you change credentials afterwards, the dashboard will fail to connect. To reset InfluxDB and start fresh: `rm -rf /var/lib/influxdb2/influxd.bolt /var/lib/influxdb2/engine`

```bash
bun run dev     # Start everything
```

Open http://localhost:3000 in your browser. Press **Ctrl+C** to stop — the script cleans up all services on exit.

## Adding Sensors

Launch Pi:

```bash
pi
```

> **First time?** Pi needs an AI model configured before use. You can either:
> - Set an API key: `export ANTHROPIC_API_KEY=sk-ant-...` (or `OPENAI_API_KEY`, etc.), then run `pi`
> - Or use a subscription: run `pi`, then type `/login` and select your provider
>
> After logging in, pick a model with `/model` (or Ctrl+L). See [Pi providers & models](https://pi.dev/models) for all options.

First, earn the sensor builder skill — paste this:

```
Read DASHBOARD_OWNER.md and save it as a Pi skill at ~/.pi/skills/dashboard-owner/SKILL.md
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
| `INFLUX_URL` | InfluxDB connection URL |
| `INFLUX_TOKEN` | InfluxDB auth token (**required**) |
| `INFLUX_ORG` | InfluxDB organization (default: `pisense`) |
| `INFLUX_BUCKET` | InfluxDB bucket (default: `sensors`) |
| `INFLUX_ADMIN_USERNAME` | InfluxDB initial admin username (first-run setup) |
| `INFLUX_ADMIN_PASSWORD` | InfluxDB initial admin password (**required for setup**) |
| `INFLUX_SETUP_TOKEN` | InfluxDB setup token (**required for setup**) |
| `MQTT_BROKER` | MQTT broker URL (default: `tcp://localhost:1883`) |
