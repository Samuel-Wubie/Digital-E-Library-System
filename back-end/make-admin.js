// ----------------------------------------------------------------------------
// One-off helper: list every account's role, or promote one to admin.
//
//   node make-admin.js                 → lists all users and their roles
//   node make-admin.js <username>      → sets that user's role to 'admin'
//
// Run it from the back-end folder (it reuses db.js / .env).
// ----------------------------------------------------------------------------
const pool = require('./db');

async function main() {
  const username = process.argv[2];

  if (!username) {
    const res = await pool.query('SELECT id, username, role, status FROM users ORDER BY id');
    console.log('\nCurrent accounts:');
    res.rows.forEach(u => console.log(`  #${u.id}  ${u.username}  →  role: "${u.role}"  (${u.status})`));
    console.log('\nTo promote one:  node make-admin.js <username>\n');
  } else {
    const res = await pool.query(
      "UPDATE users SET role = 'admin' WHERE username = $1 RETURNING id, username, role",
      [username]
    );
    if (res.rows.length === 0) {
      console.log(`No account found with username "${username}".`);
    } else {
      console.log(`Done: ${res.rows[0].username} is now role "${res.rows[0].role}".`);
    }
  }
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
