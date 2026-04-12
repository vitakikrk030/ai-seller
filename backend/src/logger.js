const isProd = process.env.NODE_ENV === 'production';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = isProd ? LEVELS.info : LEVELS.debug;

function timestamp() {
  return new Date().toISOString();
}

function format(level, msg, meta) {
  const entry = { ts: timestamp(), level, msg };
  if (meta && Object.keys(meta).length > 0) Object.assign(entry, meta);
  return JSON.stringify(entry);
}

const logger = {
  error(msg, meta = {}) {
    if (currentLevel >= LEVELS.error) console.error(format('error', msg, meta));
  },
  warn(msg, meta = {}) {
    if (currentLevel >= LEVELS.warn) console.warn(format('warn', msg, meta));
  },
  info(msg, meta = {}) {
    if (currentLevel >= LEVELS.info) console.log(format('info', msg, meta));
  },
  debug(msg, meta = {}) {
    if (currentLevel >= LEVELS.debug) console.log(format('debug', msg, meta));
  },
};

module.exports = logger;
