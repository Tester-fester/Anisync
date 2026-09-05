#!/usr/bin/env bash
# deploy/heartbeat.sh — keep-alive pinger to defeat Oracle's idle-reclamation.
#
# Oracle's Always Free policy reclaims VMs that stay below 20% CPU/memory/network
# for 7 days. For a low-traffic app, this WILL happen unless you keep the box
# warm. This script pings /health every 5 minutes.
#
# Install as a cron job ON THE VM (not your local machine):
#   sudo cp heartbeat.sh /opt/anisync/heartbeat.sh
#   sudo chmod +x /opt/anisync/heartbeat.sh
#   crontab -e
#   # add this line:
#   */5 * * * * /opt/anisync/heartbeat.sh >> /opt/anisync/logs/heartbeat.log 2>&1
#
# (Run as the anisync user, not root.)

set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health}"
LOG_PREFIX="[heartbeat $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

response=$(curl -s -m 5 -w "\n%{http_code}" "$HEALTH_URL" || echo "FAILED")
http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | head -n -1)

if [ "$http_code" = "200" ]; then
  # Only log on state change to avoid log spam.
  uptime=$(echo "$body" | grep -o '"uptime":[0-9]*' | cut -d: -f2 || echo "?")
  echo "$LOG_PREFIX OK (200) uptime=${uptime}s"
else
  echo "$LOG_PREFIX FAIL ($http_code) — service may be down"
  # Try to restart the service if health check fails 3 times in a row.
  # (simple state file)
  STATE_FILE="/tmp/anisync_heartbeat_failures"
  failures=$(cat "$STATE_FILE" 2>/dev/null || echo "0")
  failures=$((failures + 1))
  echo "$failures" > "$STATE_FILE"
  if [ "$failures" -ge 3 ]; then
    echo "$LOG_PREFIX 3 consecutive failures — restarting service"
    sudo systemctl restart anisync || true
    echo "0" > "$STATE_FILE"
  fi
fi

# Reset failure counter on success.
if [ "$http_code" = "200" ]; then
  echo "0" > /tmp/anisync_heartbeat_failures 2>/dev/null || true
fi
