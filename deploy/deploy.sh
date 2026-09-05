#!/usr/bin/env bash
# deploy/deploy.sh — zero-downtime-ish deploy script for ANISYNC on Oracle Cloud.
#
# Run this from your LOCAL machine (or CI). It:
#   1. Builds the production bundle locally (npm run build)
#   2. rsyncs dist/ + package.json + public/ to the VM
#   3. SSHs in and runs `npm ci --omit=dev` + restarts systemd
#
# Prerequisites:
#   - SSH key set up for the anisync user on the VM
#   - VM has Node 18+ installed (see deploy/README.md)
#   - VM has Caddy installed (see deploy/Caddyfile)
#   - /opt/anisync/.env already exists on the VM with secrets
#
# Usage:
#   VM_HOST=api.yourdomain.com VM_USER=anisync ./deploy/deploy.sh
#
# Or with defaults (set in the script):
#   ./deploy/deploy.sh

set -euo pipefail

VM_HOST="${VM_HOST:-api.yourdomain.com}"
VM_USER="${VM_USER:-anisync}"
REMOTE_DIR="${REMOTE_DIR:-/opt/anisync}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

echo "==> [1/5] Building production bundle locally..."
npm run build

echo "==> [2/5] Syncing dist/ + package.json + public/ to ${VM_USER}@${VM_HOST}:${REMOTE_DIR}..."
# Use --delete to keep remote clean (but preserve .env which is excluded).
rsync -avz --delete \
  --exclude '.env' \
  --exclude 'logs/' \
  --exclude 'node_modules/' \
  -e "ssh $SSH_OPTS" \
  dist/ package.json package-lock.json public/ src/ \
  "${VM_USER}@${VM_HOST}:${REMOTE_DIR}/"

echo "==> [3/5] Installing production deps on the VM..."
ssh $SSH_OPTS "${VM_USER}@${VM_HOST}" "cd ${REMOTE_DIR} && npm ci --omit=dev 2>&1 | tail -5"

echo "==> [4/5] Restarting anisync service..."
# This needs sudo — the anisync user should have passwordless sudo for systemctl.
ssh $SSH_OPTS "${VM_USER}@${VM_HOST}" "sudo systemctl restart anisync"

echo "==> [5/5] Verifying health..."
sleep 3
HEALTH=$(ssh $SSH_OPTS "${VM_USER}@${VM_HOST}" "curl -s http://localhost:3000/health" || echo "FAILED")
echo "Health response: $HEALTH"

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo ""
  echo "✅ Deploy succeeded. Service is healthy."
  echo "   Public URL: https://${VM_HOST}"
else
  echo ""
  echo "⚠️  Deploy may have failed — health check did not return ok."
  echo "   Check logs: ssh ${VM_USER}@${VM_HOST} 'sudo journalctl -u anisync -n 50'"
  exit 1
fi
