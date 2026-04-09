const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.DATABASE_URL });

module.exports = {
  query: (text, params) => pool.query(text, params),

  async init() {
    try {
      await pool.query('SELECT 1');
      console.log('Database connected');
    } catch (err) {
      console.error('Database connection error:', err.message);
      process.exit(1);
    }
  },

  pool,
};
