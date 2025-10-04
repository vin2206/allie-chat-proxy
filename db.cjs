// db.cjs
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing DATABASE_URL — coins cannot persist without it.');
}

const pool = new Pool({
  connectionString,
  // Railway is already SSL-terminated, but pg needs this on some regions
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params) {
  const res = await pool.query(sql, params);
  return res;
}

module.exports = { pool, query };
