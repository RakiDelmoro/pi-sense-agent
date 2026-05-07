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

# 4. Create .env from .env.example if missing
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "[setup] Created .env from .env.example — edit it with your credentials"
else
  echo "[setup] .env already exists"
fi

echo ""
echo "[setup] ✅ Setup complete!"
echo "[setup] Run 'bun run dev' to start the dashboard."
