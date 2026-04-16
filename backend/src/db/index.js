const { Pool } = require('pg');
const config = require('../config');
const { ensureRuntimeSchema } = require('./runtime_schema');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  options: '-c timezone=Europe/Moscow',
});

// Prevent unhandled errors from crashing the process on idle client errors
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),

  async init() {
    try {
      await pool.query("SET timezone = 'Europe/Moscow'");
      await pool.query('SELECT 1');
      await ensureRuntimeSchema(pool);
      console.log('Database connected (timezone: Europe/Moscow)');
    } catch (err) {
      console.error('Database connection error:', err.message);
      process.exit(1);
    }
  },

  pool,
};
