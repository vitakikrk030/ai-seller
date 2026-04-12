const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config');

// In-memory map of revoked token JTI's with expiry (survives until restart; for single-instance sufficient)
const _revokedJtis = new Set();
const _revokedJtiExpiry = new Map(); // jti -> expiry timestamp

// Cleanup expired JTIs every 30 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of _revokedJtiExpiry) {
    if (now > exp) {
      _revokedJtis.delete(jti);
      _revokedJtiExpiry.delete(jti);
    }
  }
}, 30 * 60 * 1000).unref();

// Hash password on first use if env has plaintext
let _hashedPassword = null;
async function getPasswordHash() {
  if (_hashedPassword) return _hashedPassword;
  const raw = config.get('ADMIN_PASSWORD') || config.ADMIN_PASSWORD;
  // If already a bcrypt hash ($2a$ or $2b$), use directly
  if (raw && (raw.startsWith('$2a$') || raw.startsWith('$2b$'))) {
    _hashedPassword = raw;
  } else {
    _hashedPassword = await bcrypt.hash(raw, 10);
  }
  return _hashedPassword;
}

// JWT auth middleware — protects all routes after it
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    // Check revocation
    if (payload.jti && _revokedJtis.has(payload.jti)) {
      return res.status(401).json({ error: 'Token revoked' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Login handler — returns access (2h) + refresh (7d) tokens
async function login(req, res) {
  const { login: loginInput, password } = req.body;
  if (!loginInput || !password) {
    return res.status(400).json({ error: 'Login and password required' });
  }
  const adminLogin = config.get('ADMIN_LOGIN') || config.ADMIN_LOGIN;
  if (loginInput !== adminLogin) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const hash = await getPasswordHash();
  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const jti = crypto.randomUUID();
  const token = jwt.sign({ login: loginInput, jti }, config.JWT_SECRET, { expiresIn: '2h' });
  const refreshToken = jwt.sign({ login: loginInput, type: 'refresh', jti: crypto.randomUUID() }, config.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, refreshToken });
}

// Refresh — exchange valid refresh token for new access+refresh tokens (rotation)
function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  try {
    const payload = jwt.verify(refreshToken, config.JWT_SECRET);
    if (payload.type !== 'refresh') return res.status(401).json({ error: 'Invalid token type' });
    if (payload.jti && _revokedJtis.has(payload.jti)) {
      return res.status(401).json({ error: 'Token revoked' });
    }
    // Revoke old refresh token (rotation)
    if (payload.jti) {
      _revokedJtis.add(payload.jti);
      _revokedJtiExpiry.set(payload.jti, Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    const jti = crypto.randomUUID();
    const token = jwt.sign({ login: payload.login, jti }, config.JWT_SECRET, { expiresIn: '2h' });
    const newRefreshToken = jwt.sign({ login: payload.login, type: 'refresh', jti: crypto.randomUUID() }, config.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, refreshToken: newRefreshToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

// Logout — revoke current token's JTI
function logout(req, res) {
  if (req.user?.jti) {
    _revokedJtis.add(req.user.jti);
    // Access tokens expire in 2h — keep JTI for that long
    _revokedJtiExpiry.set(req.user.jti, Date.now() + 2 * 60 * 60 * 1000);
  }
  // Also revoke refresh JTI if provided
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, config.JWT_SECRET, { ignoreExpiration: true });
      if (payload.jti) {
        _revokedJtis.add(payload.jti);
        // Refresh tokens expire in 7d
        _revokedJtiExpiry.set(payload.jti, Date.now() + 7 * 24 * 60 * 60 * 1000);
      }
    } catch (e) { /* ignore invalid refresh */ }
  }
  res.json({ ok: true });
}

// Verify token validity (for frontend auth check)
function verify(req, res) {
  res.json({ ok: true, user: req.user });
}

module.exports = { authMiddleware, login, verify, refresh, logout };
