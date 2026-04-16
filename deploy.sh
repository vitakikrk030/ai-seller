#!/usr/bin/env bash
# AI Seller — Production Deploy Script
# Usage: bash deploy.sh
#
# Default behavior:
# 1) Sync code from origin/main
# 2) Install deps
# 3) Run migrations (if DATABASE_URL exists)
# 4) Build frontend
# 5) Restart PM2 processes

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_NAME="${DEPLOY_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

log() {
  printf '%s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "❌ ERROR: required command '$1' not found"
    exit 1
  fi
}

run_step() {
  local title="$1"
  log ""
  log "➡️  ${title}"
}

cd "$ROOT_DIR"

log "🚀 Starting deployment in $ROOT_DIR"

run_step "Checking required tools"
require_cmd git
require_cmd node
require_cmd npm
require_cmd curl
if ! command -v pm2 >/dev/null 2>&1; then
  log "❌ ERROR: pm2 is not installed. Install pm2 before deploy."
  exit 1
fi
log "✅ Tooling OK"

run_step "Syncing latest code from ${REMOTE_NAME}/${DEPLOY_BRANCH}"
git fetch --prune "$REMOTE_NAME" "$DEPLOY_BRANCH"
git checkout "$DEPLOY_BRANCH"
git reset --hard "${REMOTE_NAME}/${DEPLOY_BRANCH}"
log "✅ Code synced to $(git rev-parse --short HEAD)"

run_step "Optional database backup"
if [[ -n "${DATABASE_URL:-}" ]] && command -v pg_dump >/dev/null 2>&1; then
  BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
  if pg_dump "$DATABASE_URL" > "$BACKUP_FILE" 2>/dev/null; then
    log "✅ Backup saved: $BACKUP_FILE"
  else
    log "⚠️  Backup failed (continuing)"
  fi
else
  log "ℹ️  DATABASE_URL or pg_dump not found, skipping backup"
fi

run_step "Installing backend dependencies"
(cd backend && npm ci --omit=dev)
log "✅ Backend dependencies installed"

run_step "Installing frontend dependencies"
(cd frontend && npm ci)
log "✅ Frontend dependencies installed"

run_step "Running database migrations"
if [[ -n "${DATABASE_URL:-}" ]]; then
  (cd backend && npm run migrate)
  log "✅ Migrations complete"
else
  log "⚠️  DATABASE_URL is empty, skipping migrations"
fi

run_step "Building frontend"
(cd frontend && npm run build)
log "✅ Frontend build complete"

run_step "Restarting PM2 apps"
mkdir -p logs
if pm2 startOrReload ecosystem.config.js --env production --update-env; then
  pm2 save
  log "✅ PM2 startOrReload successful"
else
  log "⚠️  startOrReload failed, trying reload/start fallback"
  pm2 reload ecosystem.config.js --env production --update-env || pm2 start ecosystem.config.js --env production
  pm2 save
  log "✅ PM2 fallback restart successful"
fi

run_step "Health checks"
sleep 3
if curl -sf "http://localhost:3001/health" >/dev/null; then
  log "✅ Backend health OK"
else
  log "❌ Backend health check failed"
  pm2 logs ai-seller-backend --lines 30
  exit 1
fi

if curl -sf "http://localhost:3000/login" >/dev/null; then
  log "✅ Frontend health OK"
else
  log "❌ Frontend health check failed"
  pm2 logs ai-seller-frontend --lines 30
  exit 1
fi

log ""
log "════════════════════════════════════════"
log "✅ Deployment complete!"
log "   Commit:   $(git rev-parse --short HEAD)"
log "   Branch:   $(git branch --show-current)"
log "   Backend:  http://localhost:3001"
log "   Frontend: http://localhost:3000"
log "   Status:   pm2 status"
log "════════════════════════════════════════"
