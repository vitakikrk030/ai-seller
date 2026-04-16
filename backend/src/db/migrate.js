require('dotenv').config();
const { Pool } = require('pg');
const { ensureRuntimeSchema } = require('./runtime_schema');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    await ensureRuntimeSchema(pool);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
