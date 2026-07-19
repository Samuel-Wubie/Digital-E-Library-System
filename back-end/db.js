const { Pool } = require("pg");
require("dotenv").config();

// On Railway (and most cloud hosts) a single DATABASE_URL is provided and
// SSL is required. Locally we keep using the individual DB_* variables
// from .env with no SSL.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
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
