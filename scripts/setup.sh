#!/usr/bin/env bash
set -euo pipefail

# ── PiSense Setup ──
# One command to install all dependencies and configure the project.
# Run this once after cloning the repo.

echo "[setup] PiSense Setup"
echo "====================="

# 1. Check Bun
if ! command -v bun &>/dev/null; then
  echo "[setup] ERROR: Bun is not installed."
  echo "[setup] Install it from https://bun.sh or use the devcontainer."
  exit 1
fi
echo "[setup] Bun found: $(bun --version)"

# 2. Install npm dependencies
if [ ! -d "node_modules" ]; then
  echo "[setup] Installing npm dependencies..."
  bun install
else
  echo "[setup] npm dependencies already installed"
fi

# 3. Install InfluxDB + Mosquitto (delegate to install-deps.sh)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v influxd &>/dev/null || ! command -v mosquitto &>/dev/null; then
  echo "[setup] Installing system dependencies..."
  bash "$SCRIPT_DIR/install-deps.sh"
else
  echo "[setup] InfluxDB + Mosquitto already installed"
fi

# 4. Create .env with dev-ready defaults if missing
if [ ! -f ".env" ]; then
  cat > .env << "ENVEOF"
# ── Dashboard ──
PORT=3000

# ── InfluxDB ──
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=dev-setup-token
INFLUX_ORG=pisense
INFLUX_BUCKET=sensors

# ── InfluxDB Setup (first-run only) ──
INFLUX_ADMIN_USERNAME=admin
INFLUX_ADMIN_PASSWORD=devpassword
INFLUX_SETUP_TOKEN=dev-setup-token

# ── MQTT (Mosquitto) ──
MQTT_BROKER=tcp://localhost:1883
ENVEOF
  echo "[setup] Created .env with dev defaults"
else
  echo "[setup] .env already exists"
fi

# 5. Install Pi coding agent
if ! command -v pi &>/dev/null; then
  echo "[setup] Installing Pi coding agent..."
  npm install -g @mariozechner/pi-coding-agent 2>/dev/null || npm install -g @judepayne/picode 2>/dev/null || echo "[setup] WARNING: Could not install Pi. Install manually from https://github.com/MarioZechner/pi-coding-agent"
else
  echo "[setup] Pi already installed: $(pi --version 2>/dev/null || echo "found")"
fi

echo ""
echo "[setup] ✅ Setup complete!"
echo "[setup] Run 'bun run dev' to start the dashboard."
echo "[setup] Run 'pi' to launch the coding agent and add sensors."
