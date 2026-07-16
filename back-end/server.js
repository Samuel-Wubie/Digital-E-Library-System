const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcrypt');

const app = express();

// ============================================================================
// 1. GLOBAL MIDDLEWARE
// ============================================================================
app.use(cors());
app.use(express.json());

// Standardized on 'uploades' directory to match environment configurations
const uploadDir = path.join(__dirname, 'uploades');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDir); },
  filename: (req, file, cb) => {
    // Replaces physical spaces with dashes to guarantee trouble-free browser routing URL strings
    const cleanedName = file.originalname.replace(/\s+/g, '-');
    cb(null, Date.now() + '-' + cleanedName);
  }
});
const upload = multer({ storage });

// ============================================================================
// 2. DATABASE CONFIGURATION
// ============================================================================
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'library_db',
  password: 'Samiwubie@7092',
  port: 5432,
});

const BCRYPT_SALT_ROUNDS = 10;

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('Database connection failed:', err.stack);
  else console.log('Connected to PostgreSQL at:', res.rows[0].now);
});

// ============================================================================
// 3. FILE SERVING MIDDLEWARE
// NOTE: this still serves every uploaded file unauthenticated. It's kept as
// a fallback for the existing preview modal, but it is a known bypass of the
// payment gate below (documented, not yet closed — see /api/downloads/:id/file
// for the gated path that should become the only way to fetch paid files).
// ============================================================================
app.use('/uploades', (req, res, next) => {
  req.url = decodeURIComponent(req.url);
  next();
}, express.static(uploadDir));

// ============================================================================
// CORE SYSTEM CONFIGURATION & ROUTING HELPERS
// ============================================================================
const STAGE_ORDER = ['officer', 'senior_officer', 'authorizer'];

const STAGE_ROLE_LABELS = {
  officer: 'Officer',
  senior_officer: 'Senior Officer',
  authorizer: 'Department Head',
};

async function writeAuditLog(userId, action, detail, severity = 'info') {
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, detail, severity) VALUES ($1, $2, $3, $4)',
      [userId || null, action, detail, severity]
    );
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

async function writeNotification(userId, title, message, requestId = null) {
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, request_id) VALUES ($1, $2, $3, $4)',
      [userId || null, title, message, requestId]
    );
  } catch (err) {
    console.error('Notification write failed:', err.message);
  }
}

async function nextRequestCode() {
  const result = await pool.query(
    'SELECT request_code FROM approval_requests ORDER BY id DESC LIMIT 1'
  );
  if (result.rows.length === 0) return 'REQ-1001';
  const lastNum = parseInt(result.rows[0].request_code.split('-')[1], 10) || 1000;
  return `REQ-${lastNum + 1}`;
}

// Dynamically resolves matrix stage configurations from system_settings
async function resolveChainRoles() {
  try {
    const res = await pool.query("SELECT config_data FROM system_settings WHERE setting_key = 'responsibility_map'");
    if (res.rows.length === 0) return ['Officer', 'Senior Officer', 'Department Head'];

    const map = res.rows[0].config_data;
    const parsedMap = typeof map === 'string' ? JSON.parse(map) : map;

    if (!Array.isArray(parsedMap)) return ['Officer', 'Senior Officer', 'Department Head'];

    const officerRole = parsedMap.find(r => r.stage === 'officer')?.role || 'Officer';
    const seniorOfficerRole = parsedMap.find(r => r.stage === 'senior_officer')?.role || 'Senior Officer';
    const deptHeadRole = parsedMap.find(r => r.stage === 'authorizer')?.role || 'Department Head';

    return [officerRole, seniorOfficerRole, deptHeadRole];
  } catch (err) {
    console.error('Failed to resolve workflow chain, using default:', err.message);
    return ['Officer', 'Senior Officer', 'Department Head'];
  }
}

// How many approval steps a download needs before payment, based on the
// document's security class. Admin-configurable roles for each stage still
// come from resolveChainRoles(); this only decides the LENGTH of the chain.
function chainForClass(securityClass) {
  if (securityClass === 'strict') return ['officer', 'senior_officer', 'authorizer'];
  if (securityClass === 'medium') return ['officer', 'senior_officer'];
  return []; // 'normal' — no approval chain, payment only
}

// Reads the admin-configurable per-page fee for each security class.
async function getClassFees() {
  const fallback = { normal: 2, medium: 5, strict: 10 };
  try {
    const res = await pool.query("SELECT config_data FROM system_settings WHERE setting_key = 'class_fees'");
    if (res.rows.length === 0) return fallback;
    const data = res.rows[0].config_data;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      normal: Number(parsed.normal) || fallback.normal,
      medium: Number(parsed.medium) || fallback.medium,
      strict: Number(parsed.strict) || fallback.strict,
    };
  } catch (err) {
    console.error('Failed to load class fees, using default:', err.message);
    return fallback;
  }
}

// ============================================================================
// 4. DASHBOARD ANALYTICS
// ============================================================================

// --- STAT CARDS ---
app.get('/api/dashboard/counters', async (req, res) => {
  try {
    const [active, total, newAccs, pending, auditToday] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users WHERE status = 'Active'"),
      pool.query("SELECT COUNT(*) FROM users"),
      pool.query("SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '30 days'"),
      pool.query("SELECT COUNT(*) FROM approval_requests WHERE stage IN ('officer','senior_officer','authorizer')"),
      pool.query("SELECT COUNT(*) FROM audit_logs WHERE created_at >= NOW() - INTERVAL '24 hours'"),
    ]);
    res.json({
      activeUsers:       parseInt(active.rows[0].count),
      totalUsers:        parseInt(total.rows[0].count),
      newAccounts30Days: parseInt(newAccs.rows[0].count),
      pendingApprovals:  parseInt(pending.rows[0].count),
      auditEvents24h:    parseInt(auditToday.rows[0].count),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- BAR CHART REGISTRATION TRENDS ---
app.get('/api/dashboard/registration-trends', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
             COUNT(*)::INTEGER AS count
      FROM users
      WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- TOP DOWNLOADS ---
app.get('/api/dashboard/top-downloads', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT title AS name, department AS dept, download_count AS downloads
      FROM books
      ORDER BY download_count DESC
      LIMIT 5
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- APPROVAL SNAPSHOT ---
app.get('/api/dashboard/approval-snapshot', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ar.id, ar.request_code AS "requestCode",
        ar.action, ar.target_label AS target,
        ar.stage, ar.reason, ar.created_at AS created,
        u_maker.username AS "requestedBy"
      FROM approval_requests ar
      JOIN users u_maker ON ar.requested_by = u_maker.id
      WHERE ar.stage IN ('officer','senior_officer','authorizer')
      ORDER BY ar.created_at DESC
      LIMIT 3
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 5. AUTH ROUTES
// ============================================================================

// --- LOGIN ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }
  try {
    const result = await pool.query(
      'SELECT id, username, role, password_hash FROM users WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    await pool.query(
      "UPDATE users SET status = 'Active', last_active_at = NOW() WHERE id = $1",
      [user.id]
    );
    await writeAuditLog(user.id, 'Login', `${user.username} signed in`, 'info');
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- LOGOUT ---
app.post('/api/logout', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ message: "userId is required" });
  }
  try {
    const result = await pool.query(
      "UPDATE users SET status = 'Inactive' WHERE id = $1 RETURNING id, username",
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    await writeAuditLog(userId, 'Logout', `${result.rows[0].username} signed out`, 'info');
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- PUBLIC SIGNUP ---
app.post('/api/auth/signup', async (req, res) => {
  const { fullName, username, email, password } = req.body;
  if (!fullName || !username || !password) {
    return res.status(400).json({ message: "Full name, username, and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (full_name, username, email, password_hash, role, department)
       VALUES ($1, $2, $3, $4, 'User', NULL)
       RETURNING id, full_name, username, email, role, department, status, created_at`,
      [fullName, username, email || null, passwordHash]
    );
    const newUser = result.rows[0];
    await writeAuditLog(newUser.id, 'Account created', `New self-registered account: ${newUser.username} (User)`, 'info');
    res.json(newUser);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: "Username or email already exists" });
    }
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- ADMIN CREATE USER ---
app.post('/api/users', async (req, res) => {
  const { username, email, password, role, department, createdByAdminId } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }
  if (!createdByAdminId) {
    return res.status(400).json({ message: "createdByAdminId is required" });
  }
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, department)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role, department, status, created_at`,
      [username, email || null, passwordHash, role || 'User', department || null]
    );
    const newUser = result.rows[0];
    await writeAuditLog(createdByAdminId, 'Account created', `New account: ${newUser.username} (${newUser.role})`, 'info');
    res.json(newUser);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: "Username or email already exists" });
    }
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- ACCOUNT VERIFICATION ---
app.post('/api/auth/verify-account', async (req, res) => {
  const { username, email } = req.body;
  if (!username) {
    return res.status(400).json({ message: "Username is required" });
  }
  try {
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No account found with that username" });
    }
    const user = result.rows[0];
    if (email && user.email && email.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(400).json({ message: "Email does not match our records" });
    }
    res.json({ id: user.id, username: user.username });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- RESET PASSWORD ---
app.post('/api/auth/reset-password', async (req, res) => {
  const { userId, newPassword } = req.body;
  if (!userId || !newPassword) {
    return res.status(400).json({ message: "userId and newPassword are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }
  try {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username',
      [passwordHash, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    await writeAuditLog(userId, 'Password reset', `${result.rows[0].username} reset their password`, 'warning');
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 6. USERS MANAGEMENT
// ============================================================================

app.get('/api/users', async (req, res) => {
  const { filter } = req.query;
  try {
    let query = `SELECT id, username, email, role, department, status, last_active_at, created_at FROM users`;
    if (filter === 'active') {
      query += ` WHERE status = 'Active'`;
    } else if (filter === 'new30d') {
      query += ` WHERE created_at >= NOW() - INTERVAL '30 days'`;
    }
    query += ` ORDER BY id ASC`;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.put('/api/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role, changedBy } = req.body;
  const validRoles = ['User', 'Officer', 'Senior Officer', 'Department Head', 'admin', 'manager'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }
  try {
    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
      [role, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
    const updated = result.rows[0];
    await writeAuditLog(changedBy || null, 'Role changed', `${updated.username} role changed to ${updated.role}`, 'warning');
    res.json(updated);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.put('/api/users/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, changedBy } = req.body;
  if (!['Active', 'Inactive'].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }
  try {
    const result = await pool.query(
      'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, username, status',
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
    const updated = result.rows[0];
    await writeAuditLog(changedBy || null, 'Status changed', `${updated.username} marked ${updated.status}`, 'info');
    res.json(updated);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 7. BOOKS / RECORDS
// ============================================================================

app.get('/api/books/search', async (req, res) => {
  const {
    title, author, department, location, year, yearFrom, yearTo,
    category, reportTopic, mapType, mapFormat, scale
  } = req.query;
  try {
    let query = 'SELECT * FROM books WHERE 1=1';
    const values = [];
    if (title) { values.push(`%${title}%`); query += ` AND title ILIKE $${values.length}`; }
    if (author) { values.push(`%${author}%`); query += ` AND author ILIKE $${values.length}`; }
    if (department) { values.push(department); query += ` AND department = $${values.length}`; }
    if (location) { values.push(location); query += ` AND location = $${values.length}`; }
    if (category) { values.push(category); query += ` AND category = $${values.length}`; }
    if (reportTopic) { values.push(reportTopic); query += ` AND report_topic = $${values.length}`; }
    if (mapType) { values.push(mapType); query += ` AND map_type = $${values.length}`; }
    if (mapFormat) { values.push(mapFormat); query += ` AND map_format = $${values.length}`; }
    if (scale) { values.push(scale); query += ` AND scale = $${values.length}`; }
    if (yearFrom) { values.push(parseInt(yearFrom, 10)); query += ` AND published_year >= $${values.length}`; }
    if (yearTo) { values.push(parseInt(yearTo, 10)); query += ` AND published_year <= $${values.length}`; }
    if (year && !yearFrom && !yearTo) { values.push(year); query += ` AND published_year = $${values.length}`; }
    query += ' ORDER BY id ASC';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.post('/api/books', upload.single('pdfFile'), async (req, res) => {
  const {
    title, author, department, location, published_year, page_count, uploadedBy, security_class,
    category, reportTopic, mapType, mapFormat, scale
  } = req.body;
  const file_path = req.file ? req.file.filename : null;
  const secClass = ['normal', 'medium', 'strict'].includes(security_class) ? security_class : 'normal';
  try {
    const result = await pool.query(
      `INSERT INTO books (title, author, department, location, published_year, page_count, file_path, uploaded_by, security_class,
                           category, report_topic, map_type, map_format, scale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        title, author, department, location, parseInt(published_year) || null, parseInt(page_count) || 12,
        file_path, uploadedBy ? parseInt(uploadedBy) : null, secClass,
        category || null, reportTopic || null, mapType || null, mapFormat || null, scale || null
      ]
    );
    const newBook = result.rows[0];
    await writeAuditLog(uploadedBy ? parseInt(uploadedBy) : null, 'Created', `Added record: ${newBook.title} (${secClass})`, 'info');
    res.json(newBook);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.put('/api/books/:id', upload.single('pdfFile'), async (req, res) => {
  const { id } = req.params;
  const {
    title, author, department, location, published_year, page_count, editedBy, security_class,
    category, reportTopic, mapType, mapFormat, scale
  } = req.body;
  const secClass = ['normal', 'medium', 'strict'].includes(security_class) ? security_class : 'normal';
  try {
    let result;
    if (req.file) {
      result = await pool.query(
        `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6,
                file_path=$7, security_class=$8, category=$9, report_topic=$10, map_type=$11, map_format=$12, scale=$13, updated_at=NOW()
         WHERE id=$14 RETURNING *`,
        [
          title, author, department, location, parseInt(published_year) || null, parseInt(page_count) || 12,
          req.file.filename, secClass, category || null, reportTopic || null, mapType || null, mapFormat || null, scale || null, id
        ]
      );
    } else {
      result = await pool.query(
        `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6,
                security_class=$7, category=$8, report_topic=$9, map_type=$10, map_format=$11, scale=$12, updated_at=NOW()
         WHERE id=$13 RETURNING *`,
        [
          title, author, department, location, parseInt(published_year) || null, parseInt(page_count) || 12,
          secClass, category || null, reportTopic || null, mapType || null, mapFormat || null, scale || null, id
        ]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ message: "Record not found" });
    await writeAuditLog(editedBy ? parseInt(editedBy) : null, 'Edited', `Updated record: ${result.rows[0].title}`, 'info');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.delete('/api/books/:id', async (req, res) => {
  const { id } = req.params;
  const { deletedBy } = req.body;
  try {
    const result = await pool.query('DELETE FROM books WHERE id=$1 RETURNING title', [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Record not found" });
    await writeAuditLog(deletedBy ? parseInt(deletedBy) : null, 'Deleted', `Removed record: ${result.rows[0].title}`, 'danger');
    res.json({ message: "Record deleted successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Legacy unconditional download counter — kept for anything still calling it
// directly, but the new flow should go through /api/downloads/* below so the
// security-class approval + payment gate is actually enforced.
app.post('/api/books/:id/download', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  try {
    const result = await pool.query(
      'UPDATE books SET download_count = download_count + 1 WHERE id=$1 RETURNING id, title, file_path, download_count',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Book not found" });
    const book = result.rows[0];
    await writeAuditLog(userId ? parseInt(userId) : null, 'Downloaded', book.title, 'info');
    res.json({ message: "Download tracked", filename: book.file_path });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 8. AUDIT LOGS SUBSYSTEM
// ============================================================================
app.get('/api/audit-logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT al.*, u.username 
      FROM audit_logs al 
      LEFT JOIN users u ON al.user_id = u.id 
      ORDER BY al.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 9. DYNAMIC SECURITY & ACCESS CONFIGURATION MATRIX ENDPOINTS
// ============================================================================

// --- WORKFLOW STAGE RESPONSIBILITY DEFINITIONS ---
app.get('/api/access-control/responsibility', async (req, res) => {
  try {
    const result = await pool.query("SELECT config_data FROM system_settings WHERE setting_key = 'responsibility_map'");
    if (result.rows.length > 0) {
      res.json(result.rows[0].config_data);
    } else {
      res.json(null);
    }
  } catch (err) {
    console.error("Failed to read responsibility matrix:", err.message);
    res.status(500).send("Server Error");
  }
});

app.put('/api/access-control/responsibility', async (req, res) => {
  try {
    const { responsibility, changedBy } = req.body;
    await pool.query(
      `INSERT INTO system_settings (setting_key, config_data, updated_at) 
       VALUES ('responsibility_map', $1, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET config_data = $1, updated_at = NOW()`,
      [JSON.stringify(responsibility)]
    );
    await writeAuditLog(changedBy, 'Workflow Responsibility Saved', 'Updated the dynamic routing chain layout mapping structure', 'danger');
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to write responsibility matrix:", err.message);
    res.status(500).send("Server Error");
  }
});

// --- DYNAMIC PERMISSIONS ACCESS MATRIX SYSTEM ---
app.get('/api/permissions', async (req, res) => {
  try {
    const result = await pool.query("SELECT config_data FROM system_settings WHERE setting_key = 'access_matrix'");
    if (result.rows.length > 0) {
      res.json(result.rows[0].config_data);
    } else {
      res.json(null);
    }
  } catch (err) {
    console.error("Failed to fetch access rules blueprint configuration matrix:", err.message);
    res.status(500).send("Server Error");
  }
});

app.put('/api/permissions', async (req, res) => {
  try {
    const { matrix, changedBy } = req.body;
    await pool.query(
      `INSERT INTO system_settings (setting_key, config_data, updated_at) 
       VALUES ('access_matrix', $1, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET config_data = $1, updated_at = NOW()`,
      [JSON.stringify(matrix)]
    );
    await writeAuditLog(changedBy, 'Security Matrix Saved', 'Updated the global role access permissions matrix layout configuration blueprint', 'danger');
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to persist updated security criteria access constraints matrix:", err.message);
    res.status(500).send("Server Error");
  }
});

// --- PER-PAGE FEES FOR EACH DOCUMENT SECURITY CLASS ---
app.get('/api/settings/class-fees', async (req, res) => {
  try {
    const fees = await getClassFees();
    res.json(fees);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.put('/api/settings/class-fees', async (req, res) => {
  const { fees, changedBy } = req.body;
  if (!fees || typeof fees !== 'object') {
    return res.status(400).json({ message: "fees object is required" });
  }
  const normalized = {
    normal: Number(fees.normal) || 0,
    medium: Number(fees.medium) || 0,
    strict: Number(fees.strict) || 0,
  };
  try {
    await pool.query(
      `INSERT INTO system_settings (setting_key, config_data, updated_at)
       VALUES ('class_fees', $1, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET config_data = $1, updated_at = NOW()`,
      [JSON.stringify(normalized)]
    );
    await writeAuditLog(
      changedBy, 'Class Fees Updated',
      `Per-page fees set — Normal: ${normalized.normal}, Medium: ${normalized.medium}, Strict: ${normalized.strict}`,
      'warning'
    );
    res.json({ success: true, fees: normalized });
  } catch (err) {
    console.error("Failed to persist class fees:", err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 10. DYNAMIC CHANNELS WORKFLOW ENGINE (variable-length chain with mapping matrix)
// ============================================================================

// --- DETECT ACTIVE WORKFLOW STAGE POSITION BASED ON MATRIX SETTINGS ---
app.get('/api/office-requests/my-stage', async (req, res) => {
  const { role } = req.query;
  try {
    const chainRoles = await resolveChainRoles();
    const idx = chainRoles.indexOf(role);
    if (idx === -1) return res.json({ stage: null });
    res.json({ stage: STAGE_ORDER[idx] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- SUBMIT PERMISSION CHANGE (add/edit/delete a record) — always the full 3-step chain ---
app.post('/api/office-requests', upload.single('pdfFile'), async (req, res) => {
  const { makerId, requestType, requestedPermission, targetLabel, targetBookId, reason, metaContext } = req.body;

  if (!makerId || !requestType || !targetLabel || !reason) {
    return res.status(400).json({ message: "makerId, requestType, targetLabel, and reason are required" });
  }

  try {
    const makerResult = await pool.query('SELECT id, full_name, username, role FROM users WHERE id = $1', [makerId]);
    if (makerResult.rows.length === 0) return res.status(404).json({ message: "Maker user not found" });
    const maker = makerResult.rows[0];

    let contextPayload = {};
    if (metaContext) {
      try {
        contextPayload = typeof metaContext === 'string' ? JSON.parse(metaContext) : metaContext;
      } catch (parseErr) {
        console.error("Malformed metaContext JSON string:", parseErr.message);
        return res.status(400).json({ message: "Invalid staging context structure provided." });
      }
    }
    if (req.file) contextPayload.file_path = req.file.filename;

    const requestCode = await nextRequestCode();
    const action = `Permission: ${requestedPermission}`;

    const chainRoles = await resolveChainRoles();
    const makerRoleIndex = chainRoles.indexOf(maker.role);

    let initialStage;
    if (makerRoleIndex !== -1 && (makerRoleIndex + 1) < STAGE_ORDER.length) {
      initialStage = STAGE_ORDER[makerRoleIndex + 1];
    } else {
      initialStage = STAGE_ORDER[0];
    }

    const result = await pool.query(
      `INSERT INTO approval_requests
         (request_code, action, target_label, target_book_id, reason, stage, requested_by, request_type, requested_permission, maker_full_name, maker_username, meta_context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        requestCode,
        action,
        targetLabel,
        targetBookId || null,
        reason,
        initialStage,
        makerId,
        requestType,
        requestedPermission || null,
        maker.full_name,
        maker.username,
        JSON.stringify(contextPayload)
      ]
    );

    await writeAuditLog(makerId, 'Requested', `Submitted ${requestCode} — ${action}: ${targetLabel} via routing stage [${initialStage}]`, 'warning');
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Pipeline breakdown details:", err.message);
    res.status(500).json({ message: "Server Error processing tracking workflow instance", error: err.message });
  }
});

// --- OFFICE LIST QUEUES (used by both permission and download requests) ---
app.get('/api/office-requests', async (req, res) => {
  const { stage, makerId, reviewerRole, requestType } = req.query;
  try {
    const chainRoles = await resolveChainRoles();
    const settingsMap = {
      officer: chainRoles[0],
      senior_officer: chainRoles[1],
      authorizer: chainRoles[2]
    };

    let targetedStage = stage;

    if (reviewerRole) {
      const idx = chainRoles.indexOf(reviewerRole);
      if (idx !== -1) {
        targetedStage = STAGE_ORDER[idx];
      }
    }

    let query = `
      SELECT
        ar.id, ar.request_code AS "requestCode", ar.action, ar.target_label AS "targetLabel",
        ar.target_book_id AS "targetBookId",
        ar.request_type AS "requestType", ar.requested_permission AS "requestedPermission", ar.reason, ar.stage,
        ar.security_class AS "securityClass", ar.required_stages AS "requiredStages",
        ar.fee_per_page AS "feePerPage", ar.page_count_snapshot AS "pageCount", ar.total_fee AS "totalFee",
        ar.payment_status AS "paymentStatus",
        ar.maker_full_name AS "makerFullName", ar.maker_username AS "makerUsername", ar.requested_by AS "makerId", maker.role AS "makerRole",
        ar.officer_id AS "officerId", ar.checker_id AS "seniorOfficerId", ar.authorizer_id AS "deptHeadId",
        ar.meta_context AS "metaContext",
        ar.officer_reject_reason AS "officerRejectReason", ar.senior_officer_reject_reason AS "seniorOfficerRejectReason", ar.dept_head_reject_reason AS "deptHeadRejectReason",
        TO_CHAR(ar.created_at, 'FMDD Mon, HH24:MI') AS created
      FROM approval_requests ar
      JOIN users maker ON maker.id = ar.requested_by
      WHERE 1=1
    `;
    const values = [];
    if (targetedStage) {
      values.push(targetedStage);
      query += ` AND ar.stage = $${values.length}`;
    }
    if (makerId) {
      values.push(makerId);
      query += ` AND ar.requested_by = $${values.length}`;
    }
    if (requestType) {
      values.push(requestType);
      query += ` AND ar.request_type = $${values.length}`;
    }
    query += ` ORDER BY ar.created_at DESC`;

    const result = await pool.query(query, values);

    const hydratedRows = result.rows.map(row => ({
      ...row,
      currentWorkflowStep: row.stage,
      config: settingsMap
    }));

    res.json(hydratedRows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- OFFICE STEP ACCEPT / VERIFY (handles both fixed 3-step permission
// --- requests and the variable-length download chain) ---
app.put('/api/office-requests/:id/accept', async (req, res) => {
  const { id } = req.params;
  const { actingUserId } = req.body;
  if (!actingUserId) return res.status(400).json({ message: "actingUserId is required" });

  try {
    const current = await pool.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ message: "Request not found" });
    const reqRow = current.rows[0];

    const chain = (reqRow.request_type === 'download' && reqRow.required_stages && reqRow.required_stages.length > 0)
      ? reqRow.required_stages
      : STAGE_ORDER;

    const actingUserResult = await pool.query('SELECT role FROM users WHERE id = $1', [actingUserId]);
    if (actingUserResult.rows.length === 0) return res.status(404).json({ message: "Acting user not found" });
    const actingUserRole = actingUserResult.rows[0].role;

    if (!chain.includes(reqRow.stage)) {
      return res.status(409).json({ message: `Already in terminal or unrelated stage: ${reqRow.stage}` });
    }
    if (reqRow.requested_by === parseInt(actingUserId)) {
      return res.status(403).json({ message: "Segregation of duties rule violation: Maker cannot verify their own request" });
    }

    const chainRoles = await resolveChainRoles(); // [officerRole, seniorOfficerRole, deptHeadRole]
    const stageToRole = { officer: chainRoles[0], senior_officer: chainRoles[1], authorizer: chainRoles[2] };
    const expectedRoleForStage = stageToRole[reqRow.stage];
    if (actingUserRole !== expectedRoleForStage) {
      return res.status(403).json({ message: `Role clearance matrix mismatch. Expected: ${expectedRoleForStage}` });
    }

    const currentIdx = chain.indexOf(reqRow.stage);
    const isFinalStep = currentIdx === chain.length - 1;
    const nextStage = isFinalStep ? 'approved' : chain[currentIdx + 1];

    let idColumn;
    if (reqRow.stage === 'officer') idColumn = 'officer_id';
    else if (reqRow.stage === 'senior_officer') idColumn = 'checker_id';
    else idColumn = 'authorizer_id';

    const result = await pool.query(
      `UPDATE approval_requests SET stage = $1, ${idColumn} = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [nextStage, actingUserId, id]
    );
    const roleLabel = STAGE_ROLE_LABELS[reqRow.stage];
    await writeAuditLog(actingUserId, `Office Chain: ${roleLabel} Verified`, `Request ${reqRow.request_code} advanced from '${reqRow.stage}' to '${nextStage}'`, 'info');

    if (nextStage === 'approved') {
      if (reqRow.request_type === 'download') {
        // Approval does NOT unlock the file — payment is still required.
        await writeNotification(
          reqRow.requested_by,
          'Download request approved',
          `${reqRow.request_code} — "${reqRow.target_label}" was approved. Pay ${reqRow.total_fee} to download it.`,
          reqRow.id
        );
        await writeAuditLog(reqRow.requested_by, 'Approved — Awaiting Payment', `${reqRow.request_code} approved, total fee: ${reqRow.total_fee}`, 'success');
      } else if (reqRow.request_type === 'permission') {
        const data = typeof reqRow.meta_context === 'string' ? JSON.parse(reqRow.meta_context) : reqRow.meta_context;

        if (reqRow.requested_permission === 'add') {
          await pool.query(
            `INSERT INTO books (title, author, department, location, published_year, page_count, file_path, uploaded_by, security_class,
                                 category, report_topic, map_type, map_format, scale)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              data.title, data.author, data.department, data.location, parseInt(data.published_year) || null, parseInt(data.page_count) || 12,
              data.file_path || null, reqRow.requested_by, data.security_class || 'normal',
              data.category || null, data.reportTopic || null, data.mapType || null, data.mapFormat || null, data.scale || null
            ]
          );
        } else if (reqRow.requested_permission === 'edit') {
          if (data.file_path) {
            await pool.query(
              `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6, file_path=$7, security_class=$8,
                      category=$9, report_topic=$10, map_type=$11, map_format=$12, scale=$13, updated_at=NOW() WHERE id=$14`,
              [
                data.title, data.author, data.department, data.location, parseInt(data.published_year) || null, parseInt(data.page_count) || 12,
                data.file_path, data.security_class || 'normal',
                data.category || null, data.reportTopic || null, data.mapType || null, data.mapFormat || null, data.scale || null,
                reqRow.target_book_id
              ]
            );
          } else {
            await pool.query(
              `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6, security_class=$7,
                      category=$8, report_topic=$9, map_type=$10, map_format=$11, scale=$12, updated_at=NOW() WHERE id=$13`,
              [
                data.title, data.author, data.department, data.location, parseInt(data.published_year) || null, parseInt(data.page_count) || 12,
                data.security_class || 'normal',
                data.category || null, data.reportTopic || null, data.mapType || null, data.mapFormat || null, data.scale || null,
                reqRow.target_book_id
              ]
            );
          }
        } else if (reqRow.requested_permission === 'delete') {
          await pool.query('DELETE FROM books WHERE id = $1', [reqRow.target_book_id]);
        }
        await writeAuditLog(reqRow.requested_by, 'Execution Complete', `Staging modification metrics updated successfully for action: ${reqRow.requested_permission}`, 'success');
        await writeNotification(reqRow.requested_by, 'Request approved', `${reqRow.request_code} — "${reqRow.target_label}" was approved and applied.`, reqRow.id);
      }
    } else {
      await writeNotification(
        reqRow.requested_by,
        'Request forwarded',
        `${reqRow.request_code} moved to the next reviewer (${STAGE_ROLE_LABELS[nextStage] || nextStage}).`,
        reqRow.id
      );
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Server Error");
  }
});

// --- OFFICE STEP REJECT ---
app.put('/api/office-requests/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { actingUserId, rejectReason } = req.body;
  if (!actingUserId) return res.status(400).json({ message: "actingUserId is required" });
  if (!rejectReason || !rejectReason.trim()) {
    return res.status(400).json({ message: "A reason is required to reject a request" });
  }

  try {
    const current = await pool.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ message: "Request not found" });
    const reqRow = current.rows[0];

    const chain = (reqRow.request_type === 'download' && reqRow.required_stages && reqRow.required_stages.length > 0)
      ? reqRow.required_stages
      : STAGE_ORDER;

    if (!chain.includes(reqRow.stage)) {
      return res.status(409).json({ message: `Cannot reject request from current stage: ${reqRow.stage}` });
    }

    let updateQuery;
    const cleanReason = rejectReason.trim();

    if (reqRow.stage === 'officer') {
      updateQuery = `UPDATE approval_requests SET stage = 'rejected', officer_id = $1, officer_reject_reason = $2, updated_at = NOW() WHERE id = $3 RETURNING *`;
    } else if (reqRow.stage === 'senior_officer') {
      updateQuery = `UPDATE approval_requests SET stage = 'rejected', checker_id = $1, senior_officer_reject_reason = $2, updated_at = NOW() WHERE id = $3 RETURNING *`;
    } else if (reqRow.stage === 'authorizer') {
      updateQuery = `UPDATE approval_requests SET stage = 'rejected', authorizer_id = $1, dept_head_reject_reason = $2, updated_at = NOW() WHERE id = $3 RETURNING *`;
    }

    const result = await pool.query(updateQuery, [actingUserId, cleanReason, id]);
    await writeAuditLog(actingUserId, 'Office Request Rejected', `Request ${reqRow.request_code} rejected at stage '${reqRow.stage}': ${cleanReason}`, 'danger');
    await writeNotification(reqRow.requested_by, 'Request rejected', `${reqRow.request_code} — "${reqRow.target_label}" was rejected: ${cleanReason}`, reqRow.id);

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Server Error");
  }
});

// ============================================================================
// 11. SECURITY-CLASSED DOWNLOAD + PAYMENT PIPELINE
// ============================================================================

// --- QUOTE: what will this download cost, and does it need approval first? ---
app.post('/api/downloads/initiate', async (req, res) => {
  const { bookId } = req.body;
  if (!bookId) return res.status(400).json({ message: "bookId is required" });
  try {
    const bookResult = await pool.query('SELECT id, title, page_count, security_class FROM books WHERE id = $1', [bookId]);
    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
    const book = bookResult.rows[0];

    const fees = await getClassFees();
    const securityClass = book.security_class || 'normal';
    const feePerPage = fees[securityClass];
    const pageCount = book.page_count || 12;
    const totalFee = +(feePerPage * pageCount).toFixed(2);
    const approvalChain = chainForClass(securityClass);

    res.json({
      bookId: book.id,
      title: book.title,
      securityClass,
      pageCount,
      feePerPage,
      totalFee,
      requiresApproval: approvalChain.length > 0,
      approvalChain
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- SUBMIT A DOWNLOAD REQUEST (normal docs land straight on 'approved';
//   --- medium/strict start their approval chain) ---
app.post('/api/downloads/request', async (req, res) => {
  const { bookId, userId, reason } = req.body;
  if (!bookId || !userId) return res.status(400).json({ message: "bookId and userId are required" });

  try {
    const bookResult = await pool.query('SELECT * FROM books WHERE id = $1', [bookId]);
    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
    const book = bookResult.rows[0];

    const makerResult = await pool.query('SELECT id, full_name, username, role FROM users WHERE id = $1', [userId]);
    if (makerResult.rows.length === 0) return res.status(404).json({ message: "User not found" });
    const maker = makerResult.rows[0];

    const securityClass = book.security_class || 'normal';
    const chain = chainForClass(securityClass);

    if (chain.length > 0 && (!reason || !reason.trim())) {
      return res.status(400).json({ message: "A reason is required for medium and strict documents" });
    }

    const fees = await getClassFees();
    const feePerPage = fees[securityClass];
    const pageCount = book.page_count || 12;
    const totalFee = +(feePerPage * pageCount).toFixed(2);

    const requestCode = await nextRequestCode();
    const initialStage = chain.length > 0 ? chain[0] : 'approved';

    const result = await pool.query(
      `INSERT INTO approval_requests
         (request_code, action, target_label, target_book_id, reason, stage, requested_by, request_type,
          maker_full_name, maker_username, security_class, required_stages, fee_per_page, page_count_snapshot,
          total_fee, payment_status, meta_context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'download',$8,$9,$10,$11,$12,$13,$14,'unpaid',$15) RETURNING *`,
      [
        requestCode, 'Download', `Download Document: ${book.title}`, book.id,
        reason && reason.trim() ? reason.trim() : 'Standard document — no authorization required',
        initialStage, userId, maker.full_name, maker.username, securityClass, chain,
        feePerPage, pageCount, totalFee,
        JSON.stringify({ file_path: book.file_path })
      ]
    );

    if (chain.length === 0) {
      await writeAuditLog(userId, 'Download Requested', `${requestCode} — ${book.title} (normal, no approval needed)`, 'info');
    } else {
      await writeAuditLog(userId, 'Download Requested', `${requestCode} — ${book.title} routed to [${initialStage}] (${securityClass})`, 'warning');
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Download request pipeline error:", err.message);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// --- PAY FOR AN APPROVED DOWNLOAD ---
app.post('/api/payments/checkout', async (req, res) => {
  const { requestId, userId, gateway } = req.body;
  if (!requestId || !userId) return res.status(400).json({ message: "requestId and userId are required" });

  const client = await pool.connect();
  try {
    const current = await client.query('SELECT * FROM approval_requests WHERE id = $1', [requestId]);
    if (current.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: "Request not found" });
    }
    const reqRow = current.rows[0];

    if (reqRow.requested_by !== parseInt(userId)) {
      client.release();
      return res.status(403).json({ message: "Only the requester can pay for this download" });
    }
    if (reqRow.stage !== 'approved') {
      client.release();
      return res.status(409).json({ message: "This request has not been approved yet" });
    }
    if (reqRow.payment_status === 'paid') {
      client.release();
      return res.status(409).json({ message: "This download has already been paid for" });
    }

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO payments (request_id, book_id, user_id, page_count, fee_per_page, total_amount, gateway, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed')`,
      [reqRow.id, reqRow.target_book_id, userId, reqRow.page_count_snapshot, reqRow.fee_per_page, reqRow.total_fee, gateway || 'unspecified']
    );
    const updated = await client.query(
      `UPDATE approval_requests SET payment_status = 'paid', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [reqRow.id]
    );
    await client.query('COMMIT');

    await writeAuditLog(
      userId, 'Payment Completed',
      `${reqRow.request_code} — paid ${reqRow.total_fee} (${reqRow.page_count_snapshot} pages @ ${reqRow.fee_per_page}/page)`,
      'success'
    );

    res.json({
      success: true,
      request: updated.rows[0],
      downloadUrl: `/api/downloads/${reqRow.id}/file?userId=${userId}`
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error("Payment checkout failed:", err.message);
    res.status(500).json({ message: "Payment failed", error: err.message });
  } finally {
    client.release();
  }
});

// --- GATED FILE DOWNLOAD: only the maker, only after approval + payment ---
app.get('/api/downloads/:requestId/file', async (req, res) => {
  const { requestId } = req.params;
  const { userId } = req.query;

  try {
    const current = await pool.query('SELECT * FROM approval_requests WHERE id = $1', [requestId]);
    if (current.rows.length === 0) return res.status(404).json({ message: "Request not found" });
    const reqRow = current.rows[0];

    if (String(reqRow.requested_by) !== String(userId)) {
      return res.status(403).json({ message: "This download does not belong to you" });
    }
    if (reqRow.stage !== 'approved') {
      return res.status(403).json({ message: "This request has not been approved" });
    }
    if (reqRow.payment_status !== 'paid') {
      return res.status(402).json({ message: "Payment required before downloading" });
    }

    const data = typeof reqRow.meta_context === 'string' ? JSON.parse(reqRow.meta_context) : reqRow.meta_context;
    const filePath = data && data.file_path;
    if (!filePath) return res.status(404).json({ message: "No file associated with this request" });

    const absolutePath = path.join(uploadDir, filePath);
    if (!fs.existsSync(absolutePath)) return res.status(404).json({ message: "File no longer exists on disk" });

    await pool.query('UPDATE books SET download_count = download_count + 1 WHERE id = $1', [reqRow.target_book_id]);
    await writeAuditLog(userId, 'Downloaded', `${reqRow.request_code} — file delivered`, 'info');

    res.download(absolutePath);
  } catch (err) {
    console.error("Secured download failed:", err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 12. NOTIFICATIONS
// ============================================================================
app.get('/api/notifications', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 13. SERVER STARTUP
// ============================================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server application successfully running on port ${PORT}`);
});