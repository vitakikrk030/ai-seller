const jwt = require('jsonwebtoken');
const config = require('../config');

// JWT auth middleware — protects all routes after it
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Login handler
function login(req, res) {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: 'Login and password required' });
  }
  if (login !== config.ADMIN_LOGIN || password !== config.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ login }, config.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
}

// Verify token validity (for frontend auth check)
function verify(req, res) {
  res.json({ ok: true, user: req.user });
}

module.exports = { authMiddleware, login, verify };
