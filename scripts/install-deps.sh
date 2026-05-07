#!/usr/bin/env bash
set -euo pipefail

# ── PiSense Dependency Installer ──
# Installs InfluxDB 2.x and Mosquitto inside the devcontainer.
# Called by postCreateCommand so packages are ready on first boot.

# ── Install InfluxDB ──
if ! command -v influxd &>/dev/null; then
  echo "[install] Installing InfluxDB..."
  rm -f /usr/share/keyrings/influxdata-archive-keyring.gpg
  curl -fsSL https://repos.influxdata.com/influxdata-archive.key \
    | gpg --batch --dearmor -o /usr/share/keyrings/influxdata-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/influxdata-archive-keyring.gpg] https://repos.influxdata.com/debian stable main" \
    > /etc/apt/sources.list.d/influxdata.list
  apt-get update -qq
  apt-get install -y -qq influxdb2
  echo "[install] InfluxDB installed"
else
  echo "[install] InfluxDB already installed"
fi

# ── Install Mosquitto ──
if ! command -v mosquitto &>/dev/null; then
  echo "[install] Installing Mosquitto..."
  apt-get update -qq
  apt-get install -y -qq mosquitto mosquitto-clients
  mkdir -p /etc/mosquitto/conf.d
  cat > /etc/mosquitto/conf.d/dev.conf << 'EOF'
listener 1883 0.0.0.0
allow_anonymous true
EOF
  echo "[install] Mosquitto installed"
else
  echo "[install] Mosquitto already installed"
fi

echo "[install] All dependencies ready"
