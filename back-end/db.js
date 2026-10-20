const { Pool } = require("pg");
// quiet: dotenv v17 otherwise prints a promotional banner into the log on
// every boot, which is just noise in cPanel's Node.js log viewer.
require("dotenv").config({ quiet: true });

const connectionString = process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// SSL
//
// Whether to use SSL depends on WHERE the database is, not on whether a
// connection string was used to describe it:
//
//   - A database across the public internet (Supabase, Neon, Railway's proxy)
//     must be encrypted, or the password crosses the network in the clear.
//   - A database on the same machine as the app is not on a network at all.
//     Bluehost is this case: cPanel's PostgreSQL runs on localhost, does not
//     have SSL turned on, and rejects the handshake with "The server does not
//     support SSL connections" — every query then fails.
//
// So the host decides. Local and private addresses get no SSL; anything else
// gets it. DB_SSL=true/false overrides this if a host is ever unusual.
// ---------------------------------------------------------------------------
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1|.*\.internal)$/i;

function hostFromConnectionString(str) {
  try {
    return new URL(str).hostname;
  } catch {
    // Not a parseable URL — assume remote, which is the safe default: an
    // unnecessary SSL attempt fails loudly, a skipped one leaks quietly.
    return '';
  }
}

function shouldUseSSL() {
  if (process.env.DB_SSL === 'true') return true;
  if (process.env.DB_SSL === 'false') return false;

  const host = connectionString
    ? hostFromConnectionString(connectionString)
    : (process.env.DB_HOST || 'localhost');

  return !LOCAL_HOST_PATTERN.test(host);
}

const useSSL = shouldUseSSL();

// Diagnostic: prove what this running process actually sees, with the
// password masked. If this prints "NOT SET" while you expected a connection
// string, the host is not handing the variable to the process — the problem
// is in the host's environment settings, not in this code.
console.log(
  'DATABASE_URL seen by app:',
  connectionString ? connectionString.replace(/:[^:@/]+@/, ':****@') : 'NOT SET'
);
console.log(`Database SSL: ${useSSL ? 'on' : 'off'}`);

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
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    });

pool.on('connect', () => {
  console.log("Connected to the Database ✅");
});

module.exports = pool;
