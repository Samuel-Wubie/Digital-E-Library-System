const { Pool } = require("pg");
require("dotenv").config();

// On most cloud hosts a single DATABASE_URL is provided. SSL is required
// for public/proxy addresses, but Railway's PRIVATE network address
// (postgres.railway.internal) does NOT support SSL — enabling it there
// makes every query fail. So: SSL only for non-internal hosts.
// Locally we keep using the individual DB_* variables from .env, no SSL.
const connectionString = process.env.DATABASE_URL;
const useSSL = connectionString && !connectionString.includes('railway.internal');

// Diagnostic: prove what this running container actually sees, with the
// password masked. If this prints "NOT SET", Railway isn't handing the
// variable to this process at all and the problem is on the Railway side,
// not in this code.
console.log(
  'DATABASE_URL seen by app:',
  connectionString ? connectionString.replace(/:[^:@/]+@/, ':****@') : 'NOT SET'
);

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
    });

pool.on('connect', () => {
  console.log("Connected to the Database ✅");
});

module.exports = pool;
