#!/usr/bin/env bash
set -euo pipefail

# ── PiSense Dev Launcher ──
# Starts InfluxDB + Mosquitto as native processes, then runs the dashboard.
# Everything on localhost — one command, all services.

# ── Load .env if present ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
  echo "[dev] Loaded .env"
fi

LOG_DIR="/tmp/pisense"
mkdir -p "$LOG_DIR"

# ── InfluxDB Setup Credentials (first-run only) ──
INFLUX_ADMIN_USERNAME="${INFLUX_ADMIN_USERNAME:-admin}"
INFLUX_ADMIN_PASSWORD="${INFLUX_ADMIN_PASSWORD:-devpassword}"
INFLUX_SETUP_TOKEN="${INFLUX_SETUP_TOKEN:-dev-setup-token}"

# ── Start InfluxDB (if not running) ──
start_influxdb() {
  if curl -sf -m 2 http://localhost:8086/health >/dev/null 2>&1; then
    echo "[dev] InfluxDB already running"
    return
  fi

  echo "[dev] Starting InfluxDB..."
  influxd > "$LOG_DIR/influxdb.log" 2>&1 &
  echo $! > "$LOG_DIR/influxdb.pid"

  for i in $(seq 1 30); do
    if curl -sf -m 2 http://localhost:8086/health >/dev/null 2>&1; then
      echo "[dev] InfluxDB ready on localhost:8086"
      return
    fi
    sleep 1
  done

  echo "[dev] WARNING: InfluxDB did not become healthy in 30s"
}

# ── Setup InfluxDB (first-run only) ──
setup_influxdb() {
  # Ask InfluxDB API if onboarding is still needed — don't check the
  # bolt file, because InfluxDB creates it on startup BEFORE onboarding.
  # The health endpoint may pass before the setup API is ready, so retry.
  local setup_status=""
  for i in $(seq 1 10); do
    setup_status=$(curl -sf http://localhost:8086/api/v2/setup 2>/dev/null) || true
    if echo "$setup_status" | grep -q '"allowed"'; then break; fi
    sleep 1
  done

  if echo "$setup_status" | grep -q '"allowed"[[:space:]]*:[[:space:]]*false'; then
    return  # already onboarded
  fi

  if ! echo "$setup_status" | grep -q '"allowed"[[:space:]]*:[[:space:]]*true'; then
    echo "[dev] WARNING: Could not reach InfluxDB setup API"
    return
  fi

  echo "[dev] Setting up InfluxDB (first run)..."
  sleep 1

  curl -sf -X POST http://localhost:8086/api/v2/setup \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"${INFLUX_ADMIN_USERNAME}\",
      \"password\": \"${INFLUX_ADMIN_PASSWORD}\",
      \"org\": \"${INFLUX_ORG:-pisense}\",
      \"bucket\": \"${INFLUX_BUCKET:-sensors}\",
      \"token\": \"${INFLUX_SETUP_TOKEN}\"
    }" >/dev/null 2>&1 || {
      echo "[dev] WARNING: InfluxDB setup call failed (may already be initialized)"
      return
    }

  echo "[dev] InfluxDB configured"
}

# ── Start Mosquitto ──
start_mosquitto() {
  # Always write the config so Mosquitto binds to all interfaces
  mkdir -p /etc/mosquitto/conf.d
  cat > /etc/mosquitto/conf.d/dev.conf << 'CONF'
listener 1883 0.0.0.0
allow_anonymous true
CONF

  # Stop any existing Mosquitto — it may be running without our 0.0.0.0 config
  # (e.g. started by systemd at container boot, bound to 127.0.0.1 only)
  pkill mosquitto 2>/dev/null || true
  sleep 1

  echo "[dev] Starting Mosquitto..."
  mosquitto -c /etc/mosquitto/mosquitto.conf -d 2>/dev/null || \
  mosquitto -d 2>/dev/null || true

  for i in $(seq 1 15); do
    if bash -c "echo >/dev/tcp/localhost/1883" 2>/dev/null; then
      echo "[dev] Mosquitto ready on 0.0.0.0:1883"
      return
    fi
    sleep 1
  done

  echo "[dev] WARNING: Mosquitto did not start in 15s"
}

# ── Cleanup on exit ──
cleanup() {
  if [ -f "$LOG_DIR/influxdb.pid" ]; then
    kill "$(cat "$LOG_DIR/influxdb.pid")" 2>/dev/null || true
    rm -f "$LOG_DIR/influxdb.pid"
  fi
  pkill -f "mosquitto" 2>/dev/null || true
  echo "[dev] Stopped services"
}
trap cleanup EXIT

# ── Preflight checks ──
if ! command -v influxd &>/dev/null; then
  echo "[dev] ERROR: InfluxDB not found. Run 'bun run setup' first."
  exit 1
fi
if ! command -v mosquitto &>/dev/null; then
  echo "[dev] ERROR: Mosquitto not found. Run 'bun run setup' first."
  exit 1
fi
if [ ! -d "node_modules" ]; then
  echo "[dev] ERROR: node_modules/ missing. Run 'bun install' first."
  exit 1
fi

# ── Main ──
echo "[dev] PiSense Development Launcher"
echo "=================================="

start_influxdb
setup_influxdb
start_mosquitto

echo ""
echo "[dev] All services ready!"
echo "[dev]   InfluxDB:  http://localhost:8086"
echo "[dev]   Mosquitto: tcp://localhost:1883"
echo "[dev]   Dashboard: http://localhost:3000"
echo ""

export INFLUX_URL="${INFLUX_URL:-http://localhost:8086}"
export INFLUX_TOKEN="${INFLUX_TOKEN:-${INFLUX_SETUP_TOKEN}}"
export INFLUX_ORG="${INFLUX_ORG:-pisense}"
export INFLUX_BUCKET="${INFLUX_BUCKET:-sensors}"
export MQTT_BROKER="${MQTT_BROKER:-tcp://localhost:1883}"

exec bun run server.ts
