function format(level, msg, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (meta && Object.keys(meta).length > 0) Object.assign(entry, meta);
  return JSON.stringify(entry);
}

module.exports = {
  error(msg, meta = {}) {
    console.error(format('error', msg, meta));
  },
  warn(msg, meta = {}) {
    console.warn(format('warn', msg, meta));
  },
  info(msg, meta = {}) {
    console.log(format('info', msg, meta));
  },
  debug(msg, meta = {}) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(format('debug', msg, meta));
    }
  },
};
