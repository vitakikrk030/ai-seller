#!/bin/bash
# ══════════════════════════════════════════
# AI Seller — Production Deploy Script
# ══════════════════════════════════════════
# Usage: bash deploy.sh
# Requirements: node, npm, pm2, pg_dump

set -e  # Exit on any error

echo "🚀 Starting deployment..."

# ── 1. Check required env vars ────────────
echo "📋 Checking environment..."
required_vars=("DATABASE_URL" "BOT_TOKEN" "OPENROUTER_API_KEY" "JWT_SECRET" "ADMIN_PASSWORD")
for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ ERROR: $var is not set"
    exit 1
  fi
done
echo "✅ Environment OK"

# ── 2. Backup database ────────────────────
echo "💾 Backing up database..."
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
pg_dump "$DATABASE_URL" > "$BACKUP_FILE" 2>/dev/null && echo "✅ Backup saved: $BACKUP_FILE" || echo "⚠️  Backup failed (continuing)"

# ── 3. Install dependencies ───────────────
echo "📦 Installing backend dependencies..."
cd backend && npm ci --production
cd ..

echo "📦 Installing frontend dependencies..."
cd frontend && npm ci
cd ..

# ── 4. Run migrations ─────────────────────
echo "🗄️  Running database migrations..."
cd backend && node src/db/migrate.js
cd ..
echo "✅ Migrations complete"

# ── 5. Build frontend ─────────────────────
echo "🏗️  Building frontend..."
cd frontend && npm run build
cd ..
echo "✅ Frontend built"

# ── 6. Create logs directory ──────────────
mkdir -p logs

# ── 7. Start/restart with PM2 ─────────────
echo "⚙️  Starting services with PM2..."
if pm2 list | grep -q "ai-seller-backend"; then
  pm2 reload ecosystem.config.js --env production
  echo "✅ Services reloaded"
else
  pm2 start ecosystem.config.js --env production
  pm2 save
  echo "✅ Services started"
fi

# ── 8. Health check ───────────────────────
echo "🏥 Running health check..."
sleep 3
if curl -sf "http://localhost:3001/api/stats" > /dev/null; then
  echo "✅ Backend healthy"
else
  echo "❌ Backend health check failed"
  pm2 logs ai-seller-backend --lines 20
  exit 1
fi

echo ""
echo "════════════════════════════════════════"
echo "✅ Deployment complete!"
echo "   Backend:  http://localhost:3001"
echo "   Frontend: http://localhost:3000"
echo "   Logs:     pm2 logs"
echo "   Status:   pm2 status"
echo "════════════════════════════════════════"
