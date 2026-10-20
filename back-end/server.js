const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
// bcryptjs (pure JavaScript) instead of native bcrypt — the native module
// can crash on cloud hosts (Railway) even when the rest of the app runs.
// Same API, and hashes created by either library verify with both.
const bcrypt = require('bcryptjs');

const app = express();

// ============================================================================
// 1. GLOBAL MIDDLEWARE
// ============================================================================
// CORS. On Bluehost the frontend is served by this same process on the same
// domain, so the browser never issues a cross-origin request and this is
// irrelevant — but if the frontend is ever hosted separately, list its origin
// in ALLOWED_ORIGINS (comma-separated) rather than leaving the API open to
// every website on the internet.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors(
  ALLOWED_ORIGINS.length > 0
    ? {
        origin: (origin, cb) => {
          // No Origin header = same-origin request, curl, or a server-to-server
          // call. Those are not cross-origin, so there is nothing to block.
          if (!origin) return cb(null, true);
          cb(null, ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, '')));
        },
      }
    : {} // unset → open, which is what local development wants
));
app.use(express.json());

// File storage lives in storage.js: Supabase Storage when SUPABASE_URL is
// set (production on Render, whose disk is wiped on every restart), local
// uploades/ folder otherwise (your PC). See that file for the reasoning.
const fileStore = require('./storage');
const uploadDir = fileStore.uploadDir;

// In remote mode the file goes to Supabase, so multer only needs to hold it
// in memory. In local mode it writes to disk exactly as before.
const storage = fileStore.isRemote()
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => { cb(null, uploadDir); },
      filename: (req, file, cb) => {
        // Replaces spaces with dashes for trouble-free URLs. basename()
        // strips any directory part, so a crafted upload name such as
        // "../../server.js" cannot escape the upload folder.
        const cleanedName = path.basename(file.originalname).replace(/\s+/g, '-');
        cb(null, Date.now() + '-' + cleanedName);
      }
    });

const upload = multer({
  storage,
  // Supabase's free tier rejects anything over 50 MB, so refuse it here
  // with a clear error rather than failing halfway through the upload.
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ============================================================================
// 2. DATABASE CONFIGURATION
// ============================================================================
// Shared pool from db.js — uses DATABASE_URL when present (Railway), falling
// back to local DB_* variables for local development. Previously this file
// created its own separate hardcoded pool pointed at localhost, which is why
// production always failed even when DATABASE_URL was set correctly.
const pool = require('./db');

const BCRYPT_SALT_ROUNDS = 10;

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('Database connection failed:', err.stack);
  else console.log('Connected to PostgreSQL at:', res.rows[0].now);
});

// ============================================================================
// 3. FILE SERVING
// Nothing is served straight off the filesystem in production. Files are
// reached only through the gated routes below, which check the caller first.
// That closes the old hole where /uploades served every PDF to anyone who
// knew the filename, bypassing the payment gate.
//
// This matters more on Bluehost than it did on Render: there the app runs on
// a real domain with a persistent disk, so an open /uploades route would put
// the whole document library on the open internet permanently.
//
// The static route is therefore opt-in, via SERVE_UPLOADS_STATIC=true, which
// belongs only in a local .env. See storage.js.
// ============================================================================
if (fileStore.allowStaticUploads()) {
  console.warn(
    'WARNING: /uploades is mounted as an open static route. Every stored file ' +
    'is readable by anyone who knows its filename. Never set ' +
    'SERVE_UPLOADS_STATIC=true on a public server.'
  );
  app.use('/uploades', (req, res, next) => {
    req.url = decodeURIComponent(req.url);
    next();
  }, express.static(uploadDir));
}

// Streams a stored file to the client: a redirect to a signed Supabase URL
// in remote mode, a direct disk read locally. Callers do their own
// permission checks BEFORE calling this.
async function deliverFile(res, key, { download = true } = {}) {
  if (!key) return res.status(404).json({ message: "No file associated with this record" });
  if (!(await fileStore.exists(key))) {
    return res.status(404).json({ message: "File no longer exists in storage" });
  }
  if (fileStore.isRemote()) {
    const url = await fileStore.getSignedUrl(key, { download });
    return res.redirect(url);
  }
  return download
    ? res.download(fileStore.localPath(key))
    : res.sendFile(fileStore.localPath(key));
}

// ============================================================================
// CORE SYSTEM CONFIGURATION & ROUTING HELPERS
// ============================================================================
// ============================================================================
// ROLES AND THE APPROVAL WORKFLOW
//
// Roles used to be four hardcoded strings, and the approval chain three
// hardcoded stages. Both are now rows the administrator owns.
//
// A role is a NAME plus a BEHAVIOUR. The name is free text; the behaviour is
// one of four, and it is what the rest of the system actually branches on:
//
//   member        browses, has a monthly self-service allowance, then pays
//   staff_maker   asks for documents, pays nothing, needs someone to accept
//   staff_direct  downloads immediately, no request, no fee
//   administrator the admin console
//
// Behaviour is a fixed set on purpose. Free-form switches would let someone
// create a role that reviews requests but cannot view documents, and the
// failure would show up as a confusing screen rather than an error.
//
// The workflow is an ordered list of steps, each assigned to a role. Add a
// step, remove one, reorder them — a request records the chain it was created
// with, so changing the workflow never rewrites decisions already made.
// ============================================================================

const ROLE_BEHAVIOURS = ['member', 'staff_maker', 'staff_direct', 'administrator'];

// What the system falls back to if the roles table cannot be read. These are
// the four roles this system shipped with, plus the admin accounts.
const SEED_ROLES = [
  { role_key: 'User',            label: 'User',            behaviour: 'member',        is_system: true },
  { role_key: 'Officer',         label: 'Officer',         behaviour: 'staff_maker',   is_system: true },
  { role_key: 'Senior Officer',  label: 'Senior Officer',  behaviour: 'staff_direct',  is_system: true },
  { role_key: 'Department Head', label: 'Department Head', behaviour: 'staff_direct',  is_system: true },
  { role_key: 'admin',           label: 'Administrator',   behaviour: 'administrator', is_system: true },
  { role_key: 'manager',         label: 'Manager',         behaviour: 'administrator', is_system: true },
];

// The three steps the chain ships with, in maker-checker-authorizer order.
//
// step_key is NOT the label and must not be renamed: in-flight requests store
// it in approval_requests.stage, and the legacy officer_id / checker_id /
// authorizer_id columns are keyed off it. Renaming a key would strand every
// request currently mid-review. Labels are free to change — that is what they
// are for.
const SEED_STEPS = [
  { step_key: 'officer',        label: 'Maker',      role_key: 'Officer' },
  { step_key: 'senior_officer', label: 'Checker',    role_key: 'Senior Officer' },
  { step_key: 'authorizer',     label: 'Authorizer', role_key: 'Department Head' },
];

// The labels these steps used to carry. An existing database keeps whatever is
// in the table, so rename only a step still sitting on its old default — never
// one an administrator has already named themselves.
const PREVIOUS_STEP_LABELS = {
  officer:        ['Officer review',         'Officer (Step 1)'],
  senior_officer: ['Senior Officer review',  'Senior Officer (Step 2)'],
  authorizer:     ['Department Head review', 'Department Head (Step 3 — Final)'],
};

// Bring whatever `roles` table exists into the shape this code expects.
//
// CREATE TABLE IF NOT EXISTS does nothing to a table that is already there, so
// a database that had its own `roles` table — from an earlier version of this
// project, or created by hand — keeps its own columns. The failure is quiet
// rather than loud: getRoles() falls back to the built-in list, the screen
// looks completely normal, and every write dies on a missing column.
//
// This adopts the table instead of replacing it, because it may hold rows
// somebody still depends on. Nothing is dropped and nothing is renamed.
async function adoptRolesTable() {
  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roles'"
  );
  const have = new Set(cols.rows.map(r => r.column_name));
  console.log(`roles table columns found: ${[...have].join(', ') || '(none)'}`);

  // Every column the code reads or writes. sort_order is added WITHOUT a
  // default: with `DEFAULT 0` the existing rows all silently become 0, the
  // backfill below never matches IS NULL, and the ordering ends up flat.
  await pool.query(`
    ALTER TABLE roles
      ADD COLUMN IF NOT EXISTS role_key   VARCHAR(80),
      ADD COLUMN IF NOT EXISTS label      VARCHAR(120),
      ADD COLUMN IF NOT EXISTS behaviour  VARCHAR(30),
      ADD COLUMN IF NOT EXISTS sort_order INTEGER,
      ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS is_system  BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
  `);

  // A legacy table names the role in some other column. Take the first one
  // that exists; if none do, key off the id so the row is still addressable
  // rather than being dropped.
  const nameCol = ['name', 'role_name', 'role', 'title', 'label']
    .find(c => have.has(c) && c !== 'role_key');
  const source = nameCol ? `NULLIF(TRIM("${nameCol}"::text), '')` : 'NULL';
  const filled = await pool.query(`
    UPDATE roles
       SET role_key = COALESCE(role_key, ${source}, 'role_' || id),
           label    = COALESCE(label,    ${source}, 'Role ' || id)
     WHERE role_key IS NULL OR label IS NULL
  `);
  if (filled.rowCount > 0) {
    console.log(`roles: filled role_key/label on ${filled.rowCount} row(s)` +
      (nameCol ? ` from the existing "${nameCol}" column` : ' from their ids'));
  }

  // Behaviour decides what a role can actually DO, so it is never guessed from
  // a name — except for the roles this system ships with, matched exactly.
  // Without that exception an upgrade would leave no administrator role and
  // lock the owner out of the console. Everything else becomes 'member', the
  // least privileged, for an administrator to set deliberately.
  for (const seed of SEED_ROLES) {
    await pool.query(
      'UPDATE roles SET behaviour = $1, is_system = TRUE WHERE role_key = $2 AND behaviour IS NULL',
      [seed.behaviour, seed.role_key]
    );
  }
  const guessed = await pool.query(
    "UPDATE roles SET behaviour = 'member' WHERE behaviour IS NULL RETURNING role_key"
  );
  if (guessed.rowCount > 0) {
    console.log(`roles: ${guessed.rowCount} role(s) had no behaviour and were set to 'member' ` +
      `(${guessed.rows.map(r => r.role_key).join(', ')}) — set them deliberately in Roles & workflow`);
  }

  await pool.query(`
    UPDATE roles r SET sort_order = n.rn
    FROM (SELECT id, (ROW_NUMBER() OVER (ORDER BY id)) - 1 AS rn FROM roles) n
    WHERE r.id = n.id AND r.sort_order IS NULL
  `);
  await pool.query("UPDATE roles SET is_active = TRUE  WHERE is_active IS NULL");
  await pool.query("UPDATE roles SET is_system = FALSE WHERE is_system IS NULL");

  // role_key is what users.role stores, so duplicates would make a role
  // ambiguous. The unique index is what the INSERT relies on to report "a role
  // with that name already exists" instead of quietly creating a second one.
  const dupes = await pool.query(
    'SELECT role_key, COUNT(*)::int AS n FROM roles GROUP BY role_key HAVING COUNT(*) > 1'
  );
  if (dupes.rows.length > 0) {
    // Don't destroy anything — make them distinct and say so.
    for (const d of dupes.rows) {
      await pool.query(`
        UPDATE roles r SET role_key = r.role_key || ' (' || n.rn || ')'
        FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM roles WHERE role_key = $1) n
        WHERE r.id = n.id AND n.rn > 1
      `, [d.role_key]);
    }
    console.warn(`roles: made ${dupes.rows.length} duplicated role name(s) distinct: ` +
      dupes.rows.map(d => d.role_key).join(', '));
  }
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS roles_role_key_uniq ON roles (role_key)');

  // Only now that every row has a value is NOT NULL safe to assert.
  await pool.query('ALTER TABLE roles ALTER COLUMN role_key SET NOT NULL');
  await pool.query('ALTER TABLE roles ALTER COLUMN label SET NOT NULL');
  await pool.query('ALTER TABLE roles ALTER COLUMN sort_order SET DEFAULT 0');

  await relaxLeftoverNotNulls('roles',
    ['id', 'role_key', 'label', 'behaviour', 'sort_order',
     'is_active', 'is_system', 'created_at', 'updated_at']);
}

// A table carried over from an earlier schema can have a required column this
// code knows nothing about. The INSERT never fills it, so every write dies on
// its not-null constraint, reporting a column name that appears nowhere in
// this codebase — "null value in column \"name\"", "…\"price_per_page\"".
//
// Relax those rather than dropping them: the column may hold data somebody
// still wants, and relaxing costs nothing. Columns this code writes are left
// exactly as they are.
async function relaxLeftoverNotNulls(table, mine) {
  try {
    const blocking = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
         AND is_nullable = 'NO' AND column_default IS NULL
         AND column_name <> ALL($2::text[])
    `, [table, mine]);
    for (const row of blocking.rows) {
      await pool.query(`ALTER TABLE "${table}" ALTER COLUMN "${row.column_name}" DROP NOT NULL`);
      console.log(`${table}: dropped NOT NULL on the leftover "${row.column_name}" column ` +
        `so writes can succeed (the column and its data are kept)`);
    }
  } catch (err) {
    console.error(`Could not relax leftover columns on ${table}:`, err.message);
  }
}

async function ensureRolesAndWorkflow() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id         SERIAL PRIMARY KEY,
        role_key   VARCHAR(80) UNIQUE NOT NULL,   -- what users.role stores
        label      VARCHAR(120) NOT NULL,
        behaviour  VARCHAR(30) NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_active  BOOLEAN DEFAULT TRUE,
        -- the six this system shipped with: renameable, but not removable,
        -- because code and existing accounts depend on them existing.
        is_system  BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // CREATE TABLE IF NOT EXISTS does NOTHING to a table that already exists,
    // so a database created by an earlier version keeps whatever columns it
    // had. That failure is nasty rather than loud: getRoles() falls back to
    // the built-in list and the screen looks completely normal, while adding
    // a role dies on the missing column. Add each one explicitly.
    await adoptRolesTable();
    await pool.query("UPDATE roles SET is_active = TRUE WHERE is_active IS NULL");
    await pool.query("UPDATE roles SET is_system = FALSE WHERE is_system IS NULL");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS workflow_steps (
        id         SERIAL PRIMARY KEY,
        step_key   VARCHAR(60) UNIQUE NOT NULL,
        label      VARCHAR(120) NOT NULL,
        role_key   VARCHAR(80),
        step_order INTEGER DEFAULT 0,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE workflow_steps
        ADD COLUMN IF NOT EXISTS role_key   VARCHAR(80),
        -- Optional: the specific people who staff this step. Empty means
        -- anyone holding role_key, which is how it worked before.
        ADD COLUMN IF NOT EXISTS user_ids   INTEGER[],
        ADD COLUMN IF NOT EXISTS step_order INTEGER,
        ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
    `);
    await pool.query(`
      UPDATE workflow_steps w SET step_order = n.rn
      FROM (SELECT id, (ROW_NUMBER() OVER (ORDER BY id)) - 1 AS rn FROM workflow_steps) n
      WHERE w.id = n.id AND w.step_order IS NULL
    `);
    await pool.query("ALTER TABLE workflow_steps ALTER COLUMN step_order SET DEFAULT 0");

    // Move the three built-in steps onto their maker/checker/authorizer names,
    // but only where the old default is still in place.
    for (const [key, olds] of Object.entries(PREVIOUS_STEP_LABELS)) {
      const seed = SEED_STEPS.find(st => st.step_key === key);
      if (!seed) continue;
      const renamed = await pool.query(
        'UPDATE workflow_steps SET label = $1, updated_at = NOW() WHERE step_key = $2 AND label = ANY($3::text[]) RETURNING label',
        [seed.label, key, olds]
      );
      if (renamed.rowCount > 0) console.log(`workflow step '${key}' renamed to '${seed.label}'`);
    }
    await pool.query("UPDATE workflow_steps SET is_active = TRUE WHERE is_active IS NULL");

    // Who acted at each step of a request. Replaces officer_id / checker_id /
    // authorizer_id, which could only ever hold three decisions. Those columns
    // are still written for anything that still reads them.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS approval_steps (
        id         SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL,
        step_key   VARCHAR(60),
        step_order INTEGER,
        role_key   VARCHAR(80),
        acted_by   INTEGER,
        action     VARCHAR(20),                  -- accepted | rejected
        reason     TEXT,
        acted_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS approval_steps_request_idx ON approval_steps (request_id)');

    const roleCount = await pool.query('SELECT COUNT(*)::int AS n FROM roles');
    if (roleCount.rows[0].n === 0) {
      for (let i = 0; i < SEED_ROLES.length; i++) {
        const r = SEED_ROLES[i];
        await pool.query(
          `INSERT INTO roles (role_key, label, behaviour, sort_order, is_system)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (role_key) DO NOTHING`,
          [r.role_key, r.label, r.behaviour, i, r.is_system]
        );
      }
      // Any role already sitting on an account but missing from the seed —
      // picked up so nobody is left holding a role the system doesn't know.
      const orphans = await pool.query(
        `SELECT DISTINCT role FROM users
         WHERE role IS NOT NULL AND role <> '' AND role NOT IN (SELECT role_key FROM roles)`
      );
      for (const row of orphans.rows) {
        await pool.query(
          `INSERT INTO roles (role_key, label, behaviour, sort_order) VALUES ($1,$2,'member',99)
           ON CONFLICT (role_key) DO NOTHING`,
          [row.role, row.role]
        );
        console.log(`Adopted an existing role found on accounts: "${row.role}" (set to member — check it in Admin → Roles)`);
      }
      console.log('Roles seeded');
    }

    const stepCount = await pool.query('SELECT COUNT(*)::int AS n FROM workflow_steps');
    if (stepCount.rows[0].n === 0) {
      // Honour whatever the admin had already configured under the old
      // responsibility_map before adopting the defaults.
      let configured = {};
      try {
        const res = await pool.query("SELECT config_data FROM system_settings WHERE setting_key = 'responsibility_map'");
        if (res.rows.length > 0) {
          const raw = res.rows[0].config_data;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) parsed.forEach(e => { if (e && e.stage) configured[e.stage] = e.role; });
        }
      } catch { /* defaults below are fine */ }

      for (let i = 0; i < SEED_STEPS.length; i++) {
        const st = SEED_STEPS[i];
        await pool.query(
          `INSERT INTO workflow_steps (step_key, label, role_key, step_order)
           VALUES ($1,$2,$3,$4) ON CONFLICT (step_key) DO NOTHING`,
          [st.step_key, st.label, configured[st.step_key] || st.role_key, i]
        );
      }
      console.log('Approval workflow seeded');
    }
  } catch (err) {
    console.error('Roles / workflow setup failed:', err.message);
  }
}

// --- lookups -----------------------------------------------------------------

// Set when the roles table could not be read, so /api/roles can tell the admin
// screen it is showing built-in defaults rather than its own data. Cleared the
// moment a read succeeds, so fixing the table clears the warning without a
// restart.
let rolesAreFallback = false;
let lastRolesError = null;

async function getRoles({ includeHidden = false } = {}) {
  try {
    const res = await pool.query(
      // id is sent so the admin screen can edit and remove a role. Without it
      // every Save posted to /api/roles/ with no id and came back 404 — the
      // dialog looked as though the button did nothing.
      `SELECT id, role_key AS "key", label, behaviour, sort_order AS "sortOrder",
              is_active AS "isActive", is_system AS "isSystem"
       FROM roles ${includeHidden ? '' : 'WHERE is_active = TRUE'}
       ORDER BY sort_order, id`
    );
    if (res.rows.length > 0) { rolesAreFallback = false; return res.rows; }
  } catch (err) {
    // Falling back silently is what made a broken roles table invisible: the
    // screen filled with the built-in list and looked right, while every
    // write failed. Mark the fallback so callers can say so out loud.
    console.error('ROLES TABLE UNREADABLE — serving built-in defaults. Adding or editing a role WILL fail until this is fixed:', err.message);
    rolesAreFallback = true;
    lastRolesError = err.message;
  }
  return SEED_ROLES.map((r, i) => ({
    key: r.role_key, label: r.label, behaviour: r.behaviour,
    sortOrder: i, isActive: true, isSystem: true,
  }));
}

// The behaviour for one role. An unknown role is treated as a member: the most
// restricted of the four, so a misconfiguration cannot hand out free downloads.
async function behaviourOf(roleKey) {
  if (!roleKey) return 'member';
  try {
    const res = await pool.query('SELECT behaviour FROM roles WHERE role_key = $1', [roleKey]);
    if (res.rows.length > 0) return res.rows[0].behaviour;
  } catch (err) {
    console.error('Role lookup failed:', err.message);
  }
  const seeded = SEED_ROLES.find(r => r.role_key === roleKey);
  return seeded ? seeded.behaviour : 'member';
}

// The approval chain, in order, as the admin currently has it configured.
async function getWorkflowSteps({ includeHidden = false } = {}) {
  try {
    const res = await pool.query(
      // id is sent so the admin screen can edit and remove a step. Without it
      // every Save posted to /api/workflow/ with no id at all and came back
      // 404 — the dialog looked as though the button did nothing.
      `SELECT id, step_key AS "key", label, role_key AS "roleKey",
              COALESCE(user_ids, '{}')::int[] AS "userIds",
              step_order AS "order", is_active AS "isActive"
       FROM workflow_steps ${includeHidden ? '' : 'WHERE is_active = TRUE'}
       ORDER BY step_order, id`
    );
    if (res.rows.length > 0) return res.rows;
  } catch (err) {
    console.error('Could not read the workflow, using the built-in default:', err.message);
  }
  return SEED_STEPS.map((st, i) => ({ key: st.step_key, label: st.label, roleKey: st.role_key, userIds: [], order: i, isActive: true }));
}

// Which step (if any) this role is responsible for.
async function stepForRole(roleKey) {
  const steps = await getWorkflowSteps();
  return steps.find(st => st.roleKey === roleKey) || null;
}

// Does this person staff this step?
//
// A step names a ROLE, and optionally specific PEOPLE within it. With nobody
// named, anyone holding the role staffs it — the original behaviour. With
// people named, only they do, even though colleagues share their role. That is
// the difference between "an Officer reviews this" and "Abebe reviews this".
function staffsStep(step, userId, roleKey) {
  if (!step) return false;
  const named = Array.isArray(step.userIds) ? step.userIds : [];

  // Named people decide the step OUTRIGHT — the role is not consulted at all.
  // It used to require both, which meant a step was always tied to one role
  // and you could only narrow within it. Naming people is now how you say
  // "these particular staff handle this", whoever they report to.
  if (named.length > 0) return named.map(String).includes(String(userId));

  // Nobody named: fall back to the role, which is how a step works when you
  // want anyone in a job to be able to pick it up.
  if (step.roleKey) return step.roleKey === roleKey;

  // Neither a role nor people — nobody can act, which the screen warns about.
  return false;
}

// Who a step is waiting on, in words, for a refusal message.
async function describeStepStaff(step) {
  const named = Array.isArray(step?.userIds) ? step.userIds : [];
  if (named.length > 0) {
    const res = await pool.query(
      'SELECT COALESCE(full_name, username) AS name FROM users WHERE id = ANY($1::int[])',
      [named]
    );
    return res.rows.map(r => r.name).join(' or ') || 'somebody else';
  }
  return step?.roleKey ? `the ${step.roleKey} role` : 'nobody yet';
}

// May this person decide this step, and if so, under whose authority?
//
// One place for the rule, because accept and reject must not drift apart.
// Order matters: named people are asked FIRST. A step naming Abebe is Abebe's
// step whatever job title he holds, so the role must not be allowed to refuse
// him on the way in — which is exactly what the earlier version did.
//
//   { ok: true,  coveringRole: null | delegation }  — may act
//   { ok: false, message }                          — may not, and why
async function authorityForStep(step, actingUserId, actingUserRole) {
  if (!step) return { ok: false, message: 'This step no longer exists in the workflow.' };

  const named = Array.isArray(step.userIds) ? step.userIds : [];
  const stepRole = step.roleKey || null;

  // Nothing assigned at all: nobody can act, and the fix is an administrator's.
  if (named.length === 0 && !stepRole) {
    return {
      ok: false,
      unassigned: true,
      message: `Nobody is assigned to the "${step.label || step.key}" step. An administrator needs to assign people or a role under Roles & workflow.`,
    };
  }

  // In their own right — named, or holding the role when nobody is named.
  if (staffsStep(step, actingUserId, actingUserRole)) {
    return { ok: true, coveringRole: null };
  }

  // Otherwise: are they standing in for somebody who does staff it? Cover for
  // a named person is person-to-person; cover for a role-only step is by role.
  let coveringRole = null;
  if (named.length > 0) {
    for (const uid of named) {
      coveringRole = await delegationForUser(actingUserId, uid);
      if (coveringRole) break;
    }
  } else if (stepRole) {
    coveringRole = await delegationForRole(actingUserId, stepRole);
  }
  if (coveringRole) return { ok: true, coveringRole };

  return { ok: false, message: `This step is handled by ${await describeStepStaff(step)}.` };
}

// Where this person sits in a chain of step keys, decided by who staffs each
// step — named people first, role as the fallback. -1 when they staff none.
// Used to drop the maker's own step from their request: by role alone, a
// person named on a role-less step looked like they staffed nothing.
async function ownStepIndexIn(stages, userId, roleKey) {
  const steps = await getWorkflowSteps({ includeHidden: true });
  return stages.findIndex(key => staffsStep(steps.find(s => s.key === key), userId, roleKey));
}

// The actual people who staff a step: those named on it, or — when nobody is
// named — everyone holding its role. This is what the "send to" picker shows,
// so it never offers a job title the step no longer goes through.
async function peopleForStep(step) {
  if (!step) return [];
  const named = Array.isArray(step.userIds) ? step.userIds : [];
  if (named.length > 0) {
    const r = await pool.query(
      `SELECT id, username, full_name, role, COALESCE(full_name, username) AS name
         FROM users WHERE id = ANY($1::int[]) ORDER BY username`,
      [named]
    );
    return r.rows;
  }
  if (step.roleKey) {
    const r = await pool.query(
      `SELECT id, username, full_name, role, COALESCE(full_name, username) AS name
         FROM users WHERE role = $1 ORDER BY username`,
      [step.roleKey]
    );
    return r.rows;
  }
  return [];
}


// Fallbacks only. The live chain comes from workflow_steps via
// resolveChainStages(); these are what the system falls back to if that table
// cannot be read, and they match the three steps it shipped with.
const STAGE_ORDER = ['officer', 'senior_officer', 'authorizer'];

const STAGE_ROLE_LABELS = {
  officer: 'Officer',
  senior_officer: 'Senior Officer',
  authorizer: 'Department Head',
};

// A readable name for a step, as the administrator has named it.
async function labelForStage(stageKey) {
  if (!stageKey) return stageKey;
  const steps = await getWorkflowSteps({ includeHidden: true });
  const step = steps.find(st => st.key === stageKey);
  return step ? step.label : (STAGE_ROLE_LABELS[stageKey] || stageKey);
}

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

// The roles that staff the approval chain, in order. Reads workflow_steps,
// which the administrator owns, so the chain can be any length.
async function resolveChainRoles() {
  const steps = await getWorkflowSteps();
  return steps.map(st => st.roleKey).filter(Boolean);
}

// The step keys of the chain, in order.
async function resolveChainStages() {
  const steps = await getWorkflowSteps();
  return steps.map(st => st.key);
}

// WHICH STEPS EACH ACTION HAS TO PASS THROUGH
//
// This used to be hardcoded policy: a download needed one acceptance, and
// add / edit / delete always ran the whole chain. Which steps an action needs
// is a decision for whoever runs the library, not a constant in the code —
// one institute wants deletions seen by three people and additions by none,
// another the reverse.
//
// The setting is a map of action -> ordered step keys. An empty list means the
// action needs no approval at all and happens immediately.
// A download's chain depends on how restricted the document is, so each class
// gets its own row. The stored class values are 'normal' | 'medium' | 'strict'
// — the labels changed but the values never did, so every existing document
// keeps working.
const SECURITY_CLASSES = [
  { key: 'normal', label: 'Public' },
  { key: 'medium', label: 'Confidential' },
  { key: 'strict', label: 'Highly Confidential' },
];
const DOWNLOAD_ACTIONS = SECURITY_CLASSES.map(c => `download:${c.key}`);

const PERMISSION_ACTIONS = ['view', ...DOWNLOAD_ACTIONS, 'add', 'edit', 'delete'];

// The defaults reproduce exactly what the code did before this was
// configurable, so an existing install behaves identically until somebody
// changes it: view is free, a download needs the first step, and the three
// record-changing actions run the full chain.
async function defaultActionChains() {
  const all = await resolveChainStages();
  const first = all.length > 0 ? [all[0]] : [];
  return {
    view: [],
    // Public keeps the old behaviour of one acceptance. The two restricted
    // classes start stricter, which is the point of classifying them — an
    // administrator can still change any of it.
    'download:normal': first,
    'download:medium': all.slice(0, 2),
    'download:strict': [...all],
    add: [...all],
    edit: [...all],
    delete: [...all],
  };
}

async function getActionChains() {
  const defaults = await defaultActionChains();
  try {
    const res = await pool.query(
      "SELECT config_data FROM system_settings WHERE setting_key = 'action_chains'"
    );
    if (res.rows.length === 0) return defaults;
    const raw = res.rows[0].config_data;
    const saved = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});

    // Only steps that still exist and are still switched on. A chain saved
    // against a step an administrator has since removed would otherwise
    // strand every request that reached it.
    const live = new Set(await resolveChainStages());
    const out = {};
    for (const action of PERMISSION_ACTIONS) {
      out[action] = Array.isArray(saved[action])
        ? saved[action].filter(k => live.has(k))
        : defaults[action];
    }
    return out;
  } catch (err) {
    console.error('Could not read the action chains, using the defaults:', err.message);
    return defaults;
  }
}

async function chainForAction(action) {
  const chains = await getActionChains();
  return chains[action] || [];
}

// The chain a download has to pass, for a document of this class. This used to
// ignore its argument entirely and always return the first step — the class
// decided nothing. Now Public, Confidential and Highly Confidential each have
// their own row in the matrix.
async function chainForClass(securityClass) {
  const known = SECURITY_CLASSES.some(c => c.key === securityClass);
  return chainForAction(`download:${known ? securityClass : 'normal'}`);
}

// --- READ / WRITE THE MATRIX ---
app.get('/api/workflow/action-chains', async (req, res) => {
  try {
    const [chains, steps] = await Promise.all([getActionChains(), getWorkflowSteps()]);
    res.json({
      actions: PERMISSION_ACTIONS,
      securityClasses: SECURITY_CLASSES,
      chains,
      steps: steps.map(st => ({ key: st.key, label: st.label, roleKey: st.roleKey })),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: `Could not read the action chains: ${err.message}` });
  }
});

app.put('/api/workflow/action-chains', async (req, res) => {
  const { chains, changedBy } = req.body;
  if (!chains || typeof chains !== 'object') {
    return res.status(400).json({ message: "chains is required" });
  }
  try {
    const live = await resolveChainStages();              // also gives the order
    const current = await getActionChains();
    const clean = {};
    for (const action of PERMISSION_ACTIONS) {
      // An action the caller did not mention keeps what it had. Treating a
      // missing key as "no steps" meant a partial update silently cleared
      // every other action's chain — the screen always sends all of them, but
      // anything calling this directly would have wiped the rest.
      if (!Array.isArray(chains[action])) { clean[action] = current[action] || []; continue; }
      // Stored in the chain's own order, not the order the boxes were ticked:
      // a request must travel the steps in the sequence the workflow defines.
      clean[action] = live.filter(k => chains[action].includes(k));
    }
    await pool.query(
      `INSERT INTO system_settings (setting_key, config_data, updated_at)
       VALUES ('action_chains', $1, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET config_data = $1, updated_at = NOW()`,
      [JSON.stringify(clean)]
    );
    await writeAuditLog(changedBy, 'Approval steps changed',
      PERMISSION_ACTIONS.map(a => `${a}: ${clean[a].length ? clean[a].join(' → ') : 'no approval'}`).join(' · '),
      'warning');
    res.json({ success: true, chains: clean });
  } catch (err) {
    console.error('Could not save the action chains:', err.message);
    res.status(500).json({ message: `Could not save the action chains: ${err.message}` });
  }
});

// Per-page fee for each document CATEGORY. Fees live on the category row in
// `taxonomy`, so a category the admin creates gets its price at the same
// moment it is created rather than silently being free. Keyed by the book's
// category, NOT by its security class — the class only decides whether
// approval is needed, not the price.
// A page count, or null when there genuinely isn't one.
//
// This used to be `parseInt(x) || 12`, which had two faults: a document saved
// without a page count was silently priced as 12 pages — so every document in
// a category cost the same — and a real 0 became 12 as well. Returning null
// lets the caller refuse to price it instead of inventing a number.
function pageCountOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const DEFAULT_FEES = { technical_report: 2, map: 5, other_publication: 2, book: 2 };
const DEFAULT_FEE = 2; // for a category created without a price

async function getCategoryFees() {
  try {
    const res = await pool.query(
      "SELECT item_key, fee_per_page FROM taxonomy WHERE kind = 'category'"
    );
    if (res.rows.length === 0) return { ...DEFAULT_FEES };
    const fees = {};
    for (const row of res.rows) {
      // Number() not `||`: a deliberately free category stores 0, and `||`
      // would quietly turn that back into the default price.
      const amount = Number(row.fee_per_page);
      fees[row.item_key] = Number.isFinite(amount) ? amount : DEFAULT_FEE;
    }
    return fees;
  } catch (err) {
    console.error('Failed to load category fees, using defaults:', err.message);
    return { ...DEFAULT_FEES };
  }
}

// Fee for one book. An unknown or legacy category falls back to the standard
// rate rather than to whatever Technical Reports happens to cost.
function feeForCategory(fees, category) {
  const amount = Number(fees[category]);
  return Number.isFinite(amount) ? amount : DEFAULT_FEE;
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
      // Anything not finished. Listing the step names would miss any step
      // the administrator adds later; the two terminal states never change.
      pool.query("SELECT COUNT(*) FROM approval_requests WHERE stage NOT IN ('approved','rejected')"),
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
      WHERE COALESCE(download_count, 0) > 0
        AND COALESCE(TRIM(title), '') <> ''
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
      WHERE ar.stage NOT IN ('approved','rejected')
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
    // behaviour travels with the session so the client knows which workspace
    // to open without having to recognise the role name.
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      behaviour: await behaviourOf(user.role),
    });
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

// --- USERS BY ROLE (for the "send to a specific reviewer" picker) ---
app.get('/api/users/by-role', async (req, res) => {
  const { role } = req.query;
  if (!role) return res.status(400).json({ message: "role is required" });
  try {
    const result = await pool.query(
      'SELECT id, username, full_name, role FROM users WHERE role = $1 ORDER BY username',
      [role]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- SESSION MANAGEMENT ---
// Heartbeat: called periodically by every logged-in client (all roles).
// Refreshes last_active_at; if the account was set 'Inactive' (force-logout
// by an admin, or logged out elsewhere), tells the client to log out.
app.post('/api/session/heartbeat', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const result = await pool.query(
      "UPDATE users SET last_active_at = NOW() WHERE id = $1 RETURNING status",
      [userId]
    );
    if (result.rows.length === 0) return res.json({ forceLogout: true });
    res.json({ forceLogout: result.rows[0].status !== 'Active' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Active sessions: every user currently marked Active, newest activity first.
app.get('/api/sessions/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, full_name, role, department, last_active_at
       FROM users
       WHERE status = 'Active'
       ORDER BY last_active_at DESC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Force logout: admin ends a user's session. The user's next heartbeat
// (within ~60s) sees status != 'Active' and logs the client out.
app.post('/api/sessions/force-logout', async (req, res) => {
  const { userId, adminId } = req.body;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const result = await pool.query(
      "UPDATE users SET status = 'Inactive' WHERE id = $1 RETURNING id, username",
      [userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
    await writeAuditLog(adminId || null, 'Session terminated', `Admin force-logged-out ${result.rows[0].username}`, 'warning');
    res.json({ success: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- PUBLIC SIGNUP ---
// One place that turns name parts into the pieces the database stores, so the
// sign-up form, the admin create form and the name-correction endpoint cannot
// drift apart.
function nameParts({ fullName, firstName, middleName, lastName }) {
  const clean = v => (v == null ? null : String(v).trim() || null);
  const first = clean(firstName);
  const middle = clean(middleName);
  const last = clean(lastName);
  const composed = [first, middle, last].filter(Boolean).join(' ');
  // A single fullName is still accepted — an older client may send only that.
  const full = composed || clean(fullName);
  return { first, middle, last, full: full || null };
}

app.post('/api/auth/signup', async (req, res) => {
  // Accept either a single fullName, or the firstName/middleName/lastName
  // trio the SignUp form sends, and compose full_name from the parts.
  const { fullName: rawFullName, firstName, middleName, lastName, username, email, password } = req.body;
  const parts = nameParts({ fullName: rawFullName, firstName, middleName, lastName });
  const fullName = parts.full;
  if (!fullName || !username || !password) {
    return res.status(400).json({ message: "Full name, username, and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (full_name, first_name, middle_name, last_name,
                          username, email, password_hash, role, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'User', NULL)
       RETURNING id, full_name, first_name, middle_name, last_name,
                 username, email, role, department, status, created_at`,
      [fullName, parts.first, parts.middle, parts.last, username, email || null, passwordHash]
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
  // The name used to be missing from this route entirely, so every account an
  // administrator created showed "not provided" on its detail panel for ever —
  // there was no way to set one afterwards either.
  const { username, email, password, role, department, createdByAdminId,
          fullName, firstName, middleName, lastName } = req.body;
  const parts = nameParts({ fullName, firstName, middleName, lastName });
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }
  if (!createdByAdminId) {
    return res.status(400).json({ message: "createdByAdminId is required" });
  }
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, department,
                          full_name, first_name, middle_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, username, email, role, department, status, created_at,
                 full_name, first_name, middle_name, last_name`,
      [username, email || null, passwordHash, role || 'User', department || null,
       parts.full, parts.first, parts.middle, parts.last]
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
    // full_name is sent as fullName too, because the screens that pick people
    // (approval steps, delegation) show a person's name, not their login.
    let query = `SELECT id, username, email, role, department, status, last_active_at, created_at,
                        full_name, full_name AS "fullName"
                   FROM users`;
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

// --- SET OR CORRECT A NAME ---
// Without this an account created before the name was captured — or by the
// admin form, which never asked for one — reads "not provided" permanently.
app.put('/api/users/:id/name', async (req, res) => {
  const { id } = req.params;
  const { firstName, middleName, lastName, changedBy } = req.body;
  const parts = nameParts({ firstName, middleName, lastName });
  if (!parts.first && !parts.last) {
    return res.status(400).json({ message: "A first or last name is required" });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET first_name = $1, middle_name = $2, last_name = $3, full_name = $4
        WHERE id = $5
        RETURNING id, username, full_name AS "fullName",
                  first_name AS "firstName", middle_name AS "middleName", last_name AS "lastName"`,
      [parts.first, parts.middle, parts.last, parts.full, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Account not found" });
    await writeAuditLog(changedBy, 'Account name set',
      `${result.rows[0].username} is now recorded as "${parts.full}"`, 'info');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Could not set the name:', err.message);
    res.status(500).json({ message: `Could not set the name: ${err.message}` });
  }
});

app.put('/api/users/:id/role', async (req, res) => {
  const { id } = req.params;
  const { role, changedBy } = req.body;
  // Whatever the administrator has defined, rather than a fixed list.
  const validRoles = (await getRoles({ includeHidden: true })).map(r => r.key);
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: `Unknown role. Available: ${validRoles.join(', ')}` });
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
    category, reportTopic, mapType, mapFormat, scale, subject, callNumber, pubType, classification
  } = req.query;
  try {
    let query = 'SELECT * FROM books WHERE 1=1';
    const values = [];
    if (title) { values.push(`%${title}%`); query += ` AND title ILIKE $${values.length}`; }
    if (author) { values.push(`%${author}%`); query += ` AND author ILIKE $${values.length}`; }
    if (subject) { values.push(`%${subject}%`); query += ` AND subject ILIKE $${values.length}`; }
    if (callNumber) { values.push(`%${callNumber}%`); query += ` AND call_number ILIKE $${values.length}`; }
    if (department) { values.push(department); query += ` AND department = $${values.length}`; }
    if (location) { values.push(location); query += ` AND location = $${values.length}`; }
    if (category) { values.push(category); query += ` AND category = $${values.length}`; }
    if (reportTopic) { values.push(reportTopic); query += ` AND report_topic = $${values.length}`; }
    if (mapType) { values.push(mapType); query += ` AND map_type = $${values.length}`; }
    if (mapFormat) { values.push(mapFormat); query += ` AND map_format = $${values.length}`; }
    if (scale) { values.push(scale); query += ` AND scale = $${values.length}`; }
    if (pubType) { values.push(pubType); query += ` AND pub_type = $${values.length}`; }
    if (classification) { values.push(classification); query += ` AND classification = $${values.length}`; }
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
    category, reportTopic, mapType, mapFormat, scale, subject, call_number, pubType, classification
  } = req.body;
  const secClass = ['normal', 'medium', 'strict'].includes(security_class) ? security_class : 'normal';
  try {
    const file_path = req.file ? await fileStore.saveUpload(req.file) : null;
    const result = await pool.query(
      `INSERT INTO books (title, author, department, location, published_year, page_count, file_path, uploaded_by, security_class,
                           category, report_topic, map_type, map_format, scale, subject, call_number, pub_type, classification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        title, author, department, location, parseInt(published_year) || null, pageCountOrNull(page_count),
        file_path, uploadedBy ? parseInt(uploadedBy) : null, secClass,
        category || null, reportTopic || null, mapType || null, mapFormat || null, scale || null,
        subject || null, call_number || null, pubType || null, classification || null
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
    category, reportTopic, mapType, mapFormat, scale, subject, call_number, pubType
  } = req.body;
  const secClass = ['normal', 'medium', 'strict'].includes(security_class) ? security_class : 'normal';
  try {
    let result;
    if (req.file) {
      const newKey = await fileStore.saveUpload(req.file);
      result = await pool.query(
        `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6,
                file_path=$7, security_class=$8, category=$9, report_topic=$10, map_type=$11, map_format=$12, scale=$13,
                subject=$14, call_number=$15, pub_type=$16, updated_at=NOW()
         WHERE id=$17 RETURNING *`,
        [
          title, author, department, location, parseInt(published_year) || null, pageCountOrNull(page_count),
          newKey, secClass, category || null, reportTopic || null, mapType || null, mapFormat || null, scale || null,
          subject || null, call_number || null, pubType || null, id
        ]
      );
    } else {
      result = await pool.query(
        `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6,
                security_class=$7, category=$8, report_topic=$9, map_type=$10, map_format=$11, scale=$12,
                subject=$13, call_number=$14, pub_type=$15, updated_at=NOW()
         WHERE id=$16 RETURNING *`,
        [
          title, author, department, location, parseInt(published_year) || null, pageCountOrNull(page_count),
          secClass, category || null, reportTopic || null, mapType || null, mapFormat || null, scale || null,
          subject || null, call_number || null, pubType || null, id
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

// --- PER-PAGE FEES FOR EACH DOCUMENT CATEGORY ---
// (technical reports / maps / other publications)
app.get('/api/settings/category-fees', async (req, res) => {
  try {
    const fees = await getCategoryFees();
    res.json(fees);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Fees now live on the category row in `taxonomy`, so a category the admin
// creates gets its price in the same form. This endpoint keeps its old shape
// — { category_key: number } — so the existing Download fees tab still works.
app.put('/api/settings/category-fees', async (req, res) => {
  const { fees, changedBy } = req.body;
  if (!fees || typeof fees !== 'object') {
    return res.status(400).json({ message: "fees object is required" });
  }
  try {
    const applied = [];
    for (const [key, value] of Object.entries(fees)) {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) continue;
      const r = await pool.query(
        `UPDATE taxonomy SET fee_per_page = $1, updated_at = NOW()
         WHERE kind = 'category' AND item_key = $2 RETURNING label`,
        [amount, key]
      );
      if (r.rows.length > 0) applied.push(`${r.rows[0].label}: ${amount}`);
    }
    if (applied.length === 0) {
      return res.status(400).json({ message: "No matching categories to update" });
    }
    await writeAuditLog(changedBy, 'Category Fees Updated', `Per-page fees set — ${applied.join(', ')}`, 'warning');
    res.json({ success: true, fees: await getCategoryFees() });
  } catch (err) {
    console.error("Failed to persist category fees:", err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 9b. LIBRARY STRUCTURE — admin-managed categories and classifications
//
// ADD and EDIT only. There is deliberately no DELETE route: institutional
// records keep their labels forever. To take something out of circulation the
// admin sets is_active = false, which hides it from the library while every
// document already filed under it keeps working.
// ============================================================================

const TAXONOMY_KINDS = ['category', 'report_topic', 'map_format', 'map_type', 'map_scale', 'pub_type', 'item'];

// Which list a new category's children go into. The original four have their
// own navigation; anything the admin creates gets one flat list of 'item'.
const NAV_CHILD_KIND = {
  report_topic: 'report_topic',
  pub_type: 'pub_type',
  item: 'item',
  none: 'item',
};

// Turns a label into a stable slug for item_key. The key is what gets written
// onto every document, so it must never change once rows reference it — which
// is why editing a label leaves the key alone.
function slugify(label) {
  return String(label).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 110) || 'item';
}

// Which books column records a row of this kind.
const TAXONOMY_BOOK_COLUMN = {
  category: 'category',
  report_topic: 'report_topic',
  map_format: 'map_format',
  map_type: 'map_type',
  map_scale: 'scale',
  pub_type: 'pub_type',
  item: 'classification',
};

// What a document filed under this row actually has stored in that column.
//
// Mostly it is item_key, which never changes. Two kinds are historical
// exceptions that predate this table and store display text instead:
//   report_topic — stored as "001 Abrasives (Pumice)", code and label joined
//   map_scale    — stored as the scale itself, "1:50,000"
// Renaming either of those therefore has to rewrite the documents too, or
// they would drop out of the library. renameBooksForTaxonomyRow() does that.
function storedValueFor(row) {
  if (row.kind === 'report_topic') return `${row.code || ''} ${row.label}`.trim();
  if (row.kind === 'map_scale') return row.label;
  return row.item_key;
}

// Keeps documents attached to a row whose stored value just changed. Runs in
// the caller's transaction so a half-finished rename can't strand anything.
async function renameBooksForTaxonomyRow(client, before, after) {
  const column = TAXONOMY_BOOK_COLUMN[before.kind];
  const oldValue = storedValueFor(before);
  const newValue = storedValueFor(after);
  if (!column || oldValue === newValue) return 0;
  const result = await client.query(
    `UPDATE books SET ${column} = $1, updated_at = NOW() WHERE ${column} = $2`,
    [newValue, oldValue]
  );
  return result.rowCount;
}

// --- READ THE WHOLE STRUCTURE (used by the library browser and the admin) ---
app.get('/api/taxonomy', async (req, res) => {
  const includeHidden = req.query.includeHidden === 'true';
  try {
    const result = await pool.query(
      `SELECT id, parent_id AS "parentId", kind, item_key AS "key", label, code,
              subtitle, icon, nav, fee_per_page AS "feePerPage", sort_order AS "sortOrder", is_active AS "isActive"
       FROM taxonomy
       ${includeHidden ? '' : 'WHERE is_active = TRUE'}
       ORDER BY sort_order, id`
    );
    const rows = result.rows;
    const categories = rows.filter(r => r.kind === 'category').map(cat => ({
      ...cat,
      feePerPage: cat.feePerPage === null ? null : Number(cat.feePerPage),
      children: rows.filter(r => r.parentId === cat.id),
    }));
    res.json({ categories });
  } catch (err) {
    console.error('Failed to read taxonomy:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- ADD ---
app.post('/api/taxonomy', async (req, res) => {
  const { kind, parentId, label, code, subtitle, icon, nav, feePerPage, changedBy } = req.body;
  if (!label || !String(label).trim()) return res.status(400).json({ message: "A name is required" });
  if (!TAXONOMY_KINDS.includes(kind)) return res.status(400).json({ message: "Unknown kind" });
  if (kind !== 'category' && !parentId) return res.status(400).json({ message: "parentId is required" });

  try {
    if (parentId) {
      const parent = await pool.query("SELECT id FROM taxonomy WHERE id = $1 AND kind = 'category'", [parentId]);
      if (parent.rows.length === 0) return res.status(404).json({ message: "Category not found" });
    }

    // Report topics are identified by their code, everything else by a slug
    // of its name.
    const key = kind === 'report_topic' && code ? String(code).trim() : slugify(label);

    const positionResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM taxonomy
       WHERE kind = $1 AND COALESCE(parent_id, 0) = COALESCE($2::int, 0)`,
      [kind, parentId || null]
    );

    const result = await pool.query(
      `INSERT INTO taxonomy (parent_id, kind, item_key, label, code, subtitle, icon, nav, fee_per_page, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        parentId || null, kind, key, String(label).trim(), code ? String(code).trim() : null,
        subtitle || null, icon || null,
        kind === 'category' ? (NAV_CHILD_KIND[nav] ? nav : 'item') : null,
        kind === 'category' ? (Number(feePerPage) >= 0 ? Number(feePerPage) : 0) : null,
        positionResult.rows[0].next,
      ]
    );
    await writeAuditLog(changedBy || null, 'Library structure added', `Added ${kind}: ${label}`, 'warning');
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: "Something with that name or code already exists in this list" });
    }
    console.error('Failed to add taxonomy row:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- EDIT ---
// item_key is intentionally NOT editable: it is stamped onto every document
// filed under this row, so changing it would orphan them. Renaming the label
// is safe and is what the admin actually wants.
app.put('/api/taxonomy/:id', async (req, res) => {
  const { id } = req.params;
  const { label, code, subtitle, icon, feePerPage, isActive, sortOrder, changedBy } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM taxonomy WHERE id = $1 FOR UPDATE', [id]);
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Not found" });
    }
    const row = current.rows[0];

    const result = await client.query(
      `UPDATE taxonomy SET
         label        = COALESCE($1, label),
         code         = COALESCE($2, code),
         subtitle     = COALESCE($3, subtitle),
         icon         = COALESCE($4, icon),
         fee_per_page = COALESCE($5, fee_per_page),
         is_active    = COALESCE($6, is_active),
         sort_order   = COALESCE($7, sort_order),
         updated_at   = NOW()
       WHERE id = $8 RETURNING *`,
      [
        label !== undefined ? String(label).trim() : null,
        code !== undefined ? String(code).trim() : null,
        subtitle !== undefined ? subtitle : null,
        icon !== undefined ? icon : null,
        feePerPage !== undefined && Number.isFinite(Number(feePerPage)) ? Number(feePerPage) : null,
        typeof isActive === 'boolean' ? isActive : null,
        Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null,
        id,
      ]
    );
    const updated = result.rows[0];

    // Report topics and scales are stored on each document as display text,
    // so a rename has to follow through or those documents disappear from
    // the library. Same transaction: either both change or neither does.
    const moved = await renameBooksForTaxonomyRow(client, row, updated);

    await client.query('COMMIT');

    const action = (typeof isActive === 'boolean' && isActive !== row.is_active)
      ? (isActive ? 'Library structure restored' : 'Library structure hidden')
      : 'Library structure edited';
    const detail = moved > 0
      ? `${updated.kind}: "${row.label}" → "${updated.label}" (${moved} document${moved === 1 ? '' : 's'} relabelled)`
      : `${updated.kind}: ${updated.label}`;
    await writeAuditLog(changedBy || null, action, detail, 'warning');
    res.json({ ...updated, documentsRelabelled: moved });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ message: "Something with that name or code already exists in this list" });
    }
    console.error('Failed to edit taxonomy row:', err.message);
    res.status(500).send("Server Error");
  } finally {
    client.release();
  }
});

// --- HOW MANY DOCUMENTS USE THIS ROW ---
// Shown next to each entry so the admin knows what hiding it would affect.
app.get('/api/taxonomy/:id/usage', async (req, res) => {
  const { id } = req.params;
  try {
    const current = await pool.query('SELECT * FROM taxonomy WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ message: "Not found" });
    const row = current.rows[0];

    const column = TAXONOMY_BOOK_COLUMN[row.kind];
    if (!column) return res.json({ count: 0 });

    // storedValueFor, not item_key — report topics and scales are recorded on
    // each document as display text, so matching on the key would under-count.
    const result = await pool.query(
      `SELECT COUNT(*)::int AS n FROM books WHERE ${column} = $1`,
      [storedValueFor(row)]
    );
    res.json({ count: result.rows[0].n });
  } catch (err) {
    console.error('Usage lookup failed:', err.message);
    res.status(500).send("Server Error");
  }
});


// ============================================================================
// 9c. ROLES AND WORKFLOW — administrator-managed
// ============================================================================

function slugRoleKey(label) {
  return String(label).trim().replace(/\s+/g, ' ').slice(0, 80);
}

// --- READ ---
app.get('/api/roles', async (req, res) => {
  try {
    const roles = await getRoles({ includeHidden: req.query.includeHidden === 'true' });
    // How many accounts hold each role, so the admin can see what a change
    // would affect before making it.
    const counts = await pool.query('SELECT role, COUNT(*)::int AS n FROM users GROUP BY role');
    const byRole = {};
    counts.rows.forEach(r => { byRole[r.role] = r.n; });
    res.json({
      behaviours: ROLE_BEHAVIOURS,
      roles: roles.map(r => ({ ...r, accounts: byRole[r.key] || 0 })),
      // True when the list above is the built-in fallback because the table
      // could not be read. The screen says so, instead of showing defaults
      // that look like real data while every write fails.
      usingDefaults: rolesAreFallback,
      defaultsReason: rolesAreFallback ? lastRolesError : undefined,
    });
  } catch (err) {
    console.error('Could not list roles:', err.message);
    res.status(500).json({ message: `Could not list roles: ${err.message}` });
  }
});

// --- ADD ---
app.post('/api/roles', async (req, res) => {
  const { label, behaviour, changedBy } = req.body;
  if (!label || !String(label).trim()) return res.status(400).json({ message: "A role name is required" });
  if (!ROLE_BEHAVIOURS.includes(behaviour)) {
    return res.status(400).json({ message: `Behaviour must be one of: ${ROLE_BEHAVIOURS.join(', ')}` });
  }
  try {
    const key = slugRoleKey(label);
    const next = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM roles');
    const result = await pool.query(
      `INSERT INTO roles (role_key, label, behaviour, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [key, String(label).trim(), behaviour, next.rows[0].n]
    );
    await writeAuditLog(changedBy, 'Role created', `${label} (${behaviour})`, 'warning');
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: "A role with that name already exists" });
    console.error('Could not create the role:', err.message);
    // The real reason, as JSON. This used to send the bare text "Server
    // Error", which the admin screen could not parse, so every failure here
    // showed up as "That did not work." and the cause was lost.
    res.status(500).json({ message: `Could not create the role: ${err.message}` });
  }
});

// --- EDIT ---
// Renaming a role renames it on every account that holds it, in the same
// transaction — users.role stores the name, so leaving them behind would
// orphan those accounts.
// 'add' used to be the same flag as 'edit', so every matrix saved before the
// split is missing it. Fill it in from 'edit' once, rather than defaulting it
// to false — otherwise upgrading would quietly strip the ability to add
// records from every role that had it.
//
// Idempotent: a matrix that already has 'add' on every role is left alone.
async function ensureAddPermission() {
  try {
    const settings = await pool.query(
      "SELECT config_data FROM system_settings WHERE setting_key = 'access_matrix'"
    );
    if (settings.rows.length === 0) return;
    const raw = settings.rows[0].config_data;
    const matrix = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});

    let filled = 0;
    for (const role of Object.keys(matrix)) {
      const row = matrix[role] || {};
      if (row.add === undefined) { row.add = !!row.edit; matrix[role] = row; filled += 1; }
    }
    if (filled === 0) return;

    await pool.query(
      "UPDATE system_settings SET config_data = $1, updated_at = NOW() WHERE setting_key = 'access_matrix'",
      [JSON.stringify(matrix)]
    );
    console.log(`Access matrix: 'add' split from 'edit' for ${filled} role(s)`);
  } catch (err) {
    console.error('Could not split the add permission:', err.message);
  }
}

// A role is referenced BY NAME in five places. Renaming the roles row alone
// leaves the other four pointing at a name that no longer exists, and every
// one of them fails silently: the role keeps its label but loses its
// permissions, and anyone covering for it stops covering without being told.
//
// So every rename goes through here, inside the caller's transaction.
async function renameRoleEverywhere(client, oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return { accounts: 0, delegations: 0, matrix: false };

  const accounts = await client.query('UPDATE users SET role = $1 WHERE role = $2', [newKey, oldKey]);
  await client.query('UPDATE workflow_steps SET role_key = $1 WHERE role_key = $2', [newKey, oldKey]);
  // Delegations record the role whose duties were handed over. Miss this and
  // the stand-in quietly stops being able to act.
  const delegated = await client.query(
    'UPDATE delegations SET role_key = $1 WHERE role_key = $2', [newKey, oldKey]
  );
  // The access matrix is keyed by role name, so a rename would otherwise
  // strip the role of every permission it had.
  let matrixMoved = false;
  const settings = await client.query(
    "SELECT config_data FROM system_settings WHERE setting_key = 'access_matrix' FOR UPDATE"
  );
  if (settings.rows.length > 0) {
    const raw = settings.rows[0].config_data;
    const matrix = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
    if (Object.prototype.hasOwnProperty.call(matrix, oldKey)) {
      matrix[newKey] = matrix[oldKey];
      delete matrix[oldKey];
      await client.query(
        "UPDATE system_settings SET config_data = $1, updated_at = NOW() WHERE setting_key = 'access_matrix'",
        [JSON.stringify(matrix)]
      );
      matrixMoved = true;
    }
  }
  return { accounts: accounts.rowCount, delegations: delegated.rowCount, matrix: matrixMoved };
}

// A role can be addressed by its row id or by its role_key, the identity every
// other table uses. Accepting both means a caller holding only the key — or a
// client reading a list that omits the id — still works instead of 404ing.
async function findRoleRow(client, idOrKey, { forUpdate = false } = {}) {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  if (Number.isFinite(Number(idOrKey)) && String(idOrKey).trim() !== '') {
    const byId = await client.query(`SELECT * FROM roles WHERE id = $1${lock}`, [Number(idOrKey)]);
    if (byId.rows.length > 0) return byId.rows[0];
  }
  const byKey = await client.query(`SELECT * FROM roles WHERE role_key = $1${lock}`, [String(idOrKey)]);
  return byKey.rows[0] || null;
}

app.put('/api/roles/:id', async (req, res) => {
  const { id } = req.params;
  const { label, behaviour, isActive, sortOrder, changedBy } = req.body;
  if (behaviour !== undefined && !ROLE_BEHAVIOURS.includes(behaviour)) {
    return res.status(400).json({ message: "Unknown behaviour" });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await findRoleRow(client, id, { forUpdate: true });
    if (!before) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Role not found" });
    }

    // Never leave the system with no way back in.
    if (before.behaviour === 'administrator' && behaviour && behaviour !== 'administrator') {
      const admins = await client.query(
        "SELECT COUNT(*)::int AS n FROM roles WHERE behaviour = 'administrator' AND is_active = TRUE AND id <> $1",
        [before.id]
      );
      if (admins.rows[0].n === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: "This is the last administrator role — change another role to administrator first." });
      }
    }

    const newKey = label !== undefined ? slugRoleKey(label) : before.role_key;
    const result = await client.query(
      `UPDATE roles SET
         label      = COALESCE($1, label),
         role_key   = $2,
         behaviour  = COALESCE($3, behaviour),
         is_active  = COALESCE($4, is_active),
         sort_order = COALESCE($5, sort_order),
         updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [
        label !== undefined ? String(label).trim() : null,
        newKey,
        behaviour !== undefined ? behaviour : null,
        typeof isActive === 'boolean' ? isActive : null,
        Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : null,
        before.id,
      ]
    );

    // Everything that points at this role by name moves with it.
    const carried = newKey !== before.role_key
      ? await renameRoleEverywhere(client, before.role_key, newKey)
      : { accounts: 0, delegations: 0, matrix: false };

    await client.query('COMMIT');
    await writeAuditLog(changedBy, 'Role updated',
      newKey !== before.role_key
        ? `"${before.label}" renamed to "${result.rows[0].label}" — ${carried.accounts} account(s), ` +
          `${carried.delegations} delegation(s)${carried.matrix ? ' and its access permissions' : ''} moved with it`
        : `${result.rows[0].label} (${result.rows[0].behaviour})`,
      'warning');
    res.json({
      ...result.rows[0],
      accountsMoved: carried.accounts,
      delegationsMoved: carried.delegations,
      permissionsMoved: carried.matrix,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ message: "A role with that name already exists" });
    console.error('Could not update the role:', err.message);
    res.status(500).json({ message: `Could not update the role: ${err.message}` });
  } finally {
    client.release();
  }
});

// --- REMOVE ---
// Refused while accounts still hold it. Pass reassignTo to move them first,
// so nobody is left holding a role that no longer exists.
app.delete('/api/roles/:id', async (req, res) => {
  const { id } = req.params;
  const { reassignTo, changedBy } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = await findRoleRow(client, id, { forUpdate: true });
    if (!role) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "Role not found" });
    }

    if (role.is_system) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `"${role.label}" is one of the built-in roles and cannot be removed. You can rename it, or hide it so it is no longer offered.`,
      });
    }

    const holders = await client.query('SELECT COUNT(*)::int AS n FROM users WHERE role = $1', [role.role_key]);
    const count = holders.rows[0].n;
    if (count > 0 && !reassignTo) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `${count} account${count === 1 ? '' : 's'} still hold this role. Choose a role to move them to first.`,
        accounts: count,
        needsReassign: true,
      });
    }
    if (count > 0) {
      const target = await client.query('SELECT role_key FROM roles WHERE role_key = $1', [reassignTo]);
      if (target.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: "The role you chose to move these accounts to does not exist" });
      }
      await client.query('UPDATE users SET role = $1 WHERE role = $2', [reassignTo, role.role_key]);
    }

    // A workflow step left pointing at a removed role would stall every
    // request that reaches it, so clear the pointer and deactivate the step.
    const orphanedSteps = await client.query(
      `UPDATE workflow_steps SET role_key = NULL, is_active = FALSE, updated_at = NOW()
       WHERE role_key = $1 RETURNING label`,
      [role.role_key]
    );

    // Any live cover for this role is over — the duties it carried no longer
    // exist. Ended rather than deleted, so the history still shows it happened.
    const endedCover = await client.query(
      `UPDATE delegations SET revoked_at = NOW()
       WHERE role_key = $1 AND revoked_at IS NULL AND ends_on >= CURRENT_DATE
       RETURNING id`,
      [role.role_key]
    );

    // Drop its row from the access matrix so a later role of the same name
    // does not silently inherit the dead one's permissions.
    const settings = await client.query(
      "SELECT config_data FROM system_settings WHERE setting_key = 'access_matrix' FOR UPDATE"
    );
    if (settings.rows.length > 0) {
      const raw = settings.rows[0].config_data;
      const matrix = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      if (Object.prototype.hasOwnProperty.call(matrix, role.role_key)) {
        delete matrix[role.role_key];
        await client.query(
          "UPDATE system_settings SET config_data = $1, updated_at = NOW() WHERE setting_key = 'access_matrix'",
          [JSON.stringify(matrix)]
        );
      }
    }

    await client.query('DELETE FROM roles WHERE id = $1', [role.id]);
    await client.query('COMMIT');

    await writeAuditLog(changedBy, 'Role removed',
      `${role.label}${count > 0 ? ` — ${count} account(s) moved to ${reassignTo}` : ''}` +
      `${orphanedSteps.rowCount > 0 ? `; ${orphanedSteps.rowCount} workflow step(s) turned off` : ''}` +
      `${endedCover.rowCount > 0 ? `; ${endedCover.rowCount} delegation(s) ended` : ''}`,
      'danger');
    res.json({
      success: true, accountsMoved: count,
      stepsDisabled: orphanedSteps.rowCount,
      delegationsEnded: endedCover.rowCount,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Could not remove the role:', err.message);
    res.status(500).json({ message: `Could not remove the role: ${err.message}` });
  } finally {
    client.release();
  }
});

// --- WORKFLOW STEPS ---
app.get('/api/workflow', async (req, res) => {
  try {
    res.json({ steps: await getWorkflowSteps({ includeHidden: req.query.includeHidden === 'true' }) });
  } catch (err) {
    console.error('Could not read the workflow:', err.message);
    res.status(500).send("Server Error");
  }
});

// The named people for a step, validated: each must exist and must actually
// hold the step's role. Naming somebody who does not hold the role would
// create a reviewer who can never be matched, because the role is checked
// first — a silent dead end.
// The named people for a step. Any account may be named: a step assigned to
// people is assigned to THOSE PEOPLE, whatever role they hold. Requiring them
// to hold the step's role is what made a step permanently tied to one job
// title, which is the opposite of naming individuals.
//
// The only thing checked is that the accounts exist.
async function validateStepStaff(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return { ids: [], error: null };
  const ids = [...new Set(userIds.map(n => parseInt(n, 10)).filter(Number.isFinite))];
  if (ids.length === 0) return { ids: [], error: null };
  const res = await pool.query(
    'SELECT id, role, COALESCE(full_name, username) AS name FROM users WHERE id = ANY($1::int[])',
    [ids]
  );
  const found = new Set(res.rows.map(r => String(r.id)));
  const missing = ids.filter(i => !found.has(String(i)));
  if (missing.length > 0) {
    return { ids: [], error: `No account with id ${missing.join(', ')}` };
  }

  // Any account may staff a step whatever its job title — that is the point of
  // naming people. The one exception is a member-behaviour account: members are
  // sent to the reader workspace and never see an approval queue, so a step
  // naming one would stop every request that reached it.
  const blocked = [];
  for (const row of res.rows) {
    if (await behaviourOf(row.role) === 'member') blocked.push(row.name);
  }
  if (blocked.length > 0) {
    return {
      ids: [],
      error: `${blocked.join(', ')} ${blocked.length === 1 ? 'is a reader and' : 'are readers and'} never sees an approval queue, so ${blocked.length === 1 ? 'they' : 'they'} cannot staff a step. Change their role's behaviour first, or pick somebody else.`,
    };
  }
  return { ids, error: null };
}

app.post('/api/workflow', async (req, res) => {
  const { label, roleKey, userIds, changedBy } = req.body;
  if (!label || !String(label).trim()) return res.status(400).json({ message: "A step name is required" });
  try {
    const staff = await validateStepStaff(userIds);
    if (staff.error) return res.status(400).json({ message: staff.error });
    const key = String(label).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || `step_${Date.now()}`;
    const next = await pool.query('SELECT COALESCE(MAX(step_order), -1) + 1 AS n FROM workflow_steps');
    const result = await pool.query(
      `INSERT INTO workflow_steps (step_key, label, role_key, user_ids, step_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [key, String(label).trim(), roleKey || null, staff.ids, next.rows[0].n]
    );
    await writeAuditLog(changedBy, 'Workflow step added',
      `${label} → ${roleKey || 'nobody yet'}${staff.ids.length ? ` (limited to ${staff.ids.length} named ${staff.ids.length === 1 ? 'person' : 'people'})` : ''}`,
      'danger');
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: "A step with that name already exists" });
    console.error('Could not add the workflow step:', err.message);
    res.status(500).send("Server Error");
  }
});

// A step can be addressed by its row id or by its step_key. The key is the
// identity the rest of the system uses, so accepting both means a caller that
// only has the key — or a client reading a list that omits the id — still works
// instead of failing with a bare 404.
async function findWorkflowStep(idOrKey) {
  const byId = Number.isFinite(Number(idOrKey)) && String(idOrKey).trim() !== ''
    ? await pool.query('SELECT * FROM workflow_steps WHERE id = $1', [Number(idOrKey)])
    : { rows: [] };
  if (byId.rows.length > 0) return byId.rows[0];
  const byKey = await pool.query('SELECT * FROM workflow_steps WHERE step_key = $1', [String(idOrKey)]);
  return byKey.rows[0] || null;
}

app.put('/api/workflow/:id', async (req, res) => {
  const { id } = req.params;
  const { label, roleKey, userIds, isActive, stepOrder, changedBy } = req.body;
  try {
    const existing = await findWorkflowStep(id);
    if (!existing) return res.status(404).json({ message: "Step not found" });

    let staffIds = null;
    if (userIds !== undefined) {
      const staff = await validateStepStaff(userIds);
      if (staff.error) return res.status(400).json({ message: staff.error });
      staffIds = staff.ids;
    }

    // Only the fields actually sent are written. COALESCE cannot do this: a
    // step is allowed to have NO role now that people can be named on it, and
    // COALESCE read that null as "leave the role alone", so clearing a role
    // was impossible.
    const sets = ['updated_at = NOW()'];
    const values = [];
    if (label !== undefined) { values.push(String(label).trim()); sets.push(`label = $${values.length}`); }
    if (roleKey !== undefined) { values.push(roleKey || null); sets.push(`role_key = $${values.length}`); }
    if (staffIds !== null) { values.push(staffIds); sets.push(`user_ids = $${values.length}`); }
    if (typeof isActive === 'boolean') { values.push(isActive); sets.push(`is_active = $${values.length}`); }
    if (Number.isFinite(Number(stepOrder))) { values.push(Number(stepOrder)); sets.push(`step_order = $${values.length}`); }
    values.push(existing.id);

    const result = await pool.query(
      `UPDATE workflow_steps SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Step not found" });
    const named = (result.rows[0].user_ids || []).length;
    await writeAuditLog(changedBy, 'Workflow step updated',
      `${result.rows[0].label} → ${result.rows[0].role_key || 'nobody'}${named ? ` (limited to ${named} named ${named === 1 ? 'person' : 'people'})` : ' (anyone in the role)'}`,
      'danger');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Could not update the workflow step:', err.message);
    res.status(500).json({ message: `Could not update the workflow step: ${err.message}` });
  }
});

app.delete('/api/workflow/:id', async (req, res) => {
  const { id } = req.params;
  const { changedBy } = req.body || {};
  try {
    const steps = await pool.query('SELECT COUNT(*)::int AS n FROM workflow_steps WHERE is_active = TRUE');
    const current = await findWorkflowStep(id);
    if (!current) return res.status(404).json({ message: "Step not found" });
    if (steps.rows[0].n <= 1 && current.is_active) {
      return res.status(409).json({ message: "This is the only step left. A workflow needs at least one." });
    }
    await pool.query('DELETE FROM workflow_steps WHERE id = $1', [current.id]);
    await writeAuditLog(changedBy, 'Workflow step removed', current.label, 'danger');
    res.json({ success: true });
  } catch (err) {
    console.error('Could not remove the workflow step:', err.message);
    res.status(500).json({ message: `Could not remove the workflow step: ${err.message}` });
  }
});


// ============================================================================
// DELEGATION — leave cover
//
// When someone who staffs an approval step is away, they hand their review
// duties to a colleague for a date range. While it is running the delegate can
// act on that role's steps as well as their own, and sees both queues.
//
// Deliberate choices:
//   - Dates, not a switch. An open-ended delegation is one people forget to
//     turn off, and the authority quietly outlives the leave.
//   - Additive. The delegate keeps their own role; nothing is taken away.
//   - Every action is recorded as the delegate acting on behalf of the person
//     they are covering. An institution needs to see who really pressed it.
//   - Separation of duties still applies: a delegate cannot approve a request
//     they raised themselves, exactly as the person they cover could not.
// ============================================================================
async function ensureDelegations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS delegations (
        id           SERIAL PRIMARY KEY,
        from_user_id INTEGER NOT NULL,
        to_user_id   INTEGER NOT NULL,
        role_key     VARCHAR(80) NOT NULL,   -- the authority being handed over
        starts_on    DATE NOT NULL,
        ends_on      DATE NOT NULL,
        reason       TEXT,
        -- WHICH duties were handed over. 'approvals' is authority over the
        -- delegator's step in the chain; the rest mirror the access matrix.
        -- Partial delegation is the common case: cover my reviews while I am
        -- away, but do not also hand over the ability to delete records.
        scopes       TEXT[] DEFAULT ARRAY['approvals'],
        revoked_at   TIMESTAMP,
        created_by   INTEGER,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS delegations_to_idx ON delegations (to_user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS delegations_from_idx ON delegations (from_user_id)');
    // for databases created before scopes existed
    await pool.query("ALTER TABLE delegations ADD COLUMN IF NOT EXISTS scopes TEXT[] DEFAULT ARRAY['approvals']");
  } catch (err) {
    console.error('Delegation setup failed:', err.message);
  }
}

// Delegations currently in force for this person — what they are covering.
// CURRENT_DATE so a delegation starts and ends on its own, with nobody
// remembering to switch it off.
async function activeDelegationsTo(userId) {
  if (!userId) return [];
  try {
    const res = await pool.query(
      `SELECT d.id, d.role_key AS "roleKey", d.from_user_id AS "fromUserId",
              d.starts_on AS "startsOn", d.ends_on AS "endsOn",
              COALESCE(d.scopes, ARRAY['approvals']) AS scopes,
              COALESCE(u.full_name, u.username) AS "fromName"
       FROM delegations d
       LEFT JOIN users u ON u.id = d.from_user_id
       WHERE d.to_user_id = $1
         AND d.revoked_at IS NULL
         AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on`,
      [userId]
    );
    return res.rows;
  } catch (err) {
    console.error('Could not read delegations:', err.message);
    return [];
  }
}

// Every role this person may act as right now: their own, plus anything
// delegated to them.
async function effectiveRolesFor(userId) {
  try {
    const own = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    const roles = own.rows.length > 0 && own.rows[0].role ? [own.rows[0].role] : [];
    const delegated = await activeDelegationsTo(userId);
    delegated.forEach(d => { if (d.roleKey && !roles.includes(d.roleKey)) roles.push(d.roleKey); });
    return roles;
  } catch (err) {
    console.error('Could not resolve effective roles:', err.message);
    return [];
  }
}

// The responsibilities that can be handed over. 'approvals' is authority over
// the delegator's step; the rest mirror the access matrix.
const DELEGATION_SCOPES = ['approvals', 'add', 'edit', 'delete', 'download'];

function hasScope(delegation, scope) {
  const scopes = Array.isArray(delegation?.scopes) ? delegation.scopes : ['approvals'];
  return scopes.includes(scope);
}

// Is this person currently covering the APPROVAL duties of whoever holds
// `roleKey`? A delegation that only handed over, say, editing does not let
// the delegate decide on requests.
async function delegationForRole(userId, roleKey) {
  const active = await activeDelegationsTo(userId);
  return active.find(d => d.roleKey === roleKey && hasScope(d, 'approvals')) || null;
}

// Is this person currently covering a specific colleague's approvals? Used
// when a request was addressed to one named reviewer who is now away.
async function delegationForUser(userId, forUserId) {
  const active = await activeDelegationsTo(userId);
  return active.find(d => String(d.fromUserId) === String(forUserId) && hasScope(d, 'approvals')) || null;
}

// What this person is allowed to HAND OVER. You cannot delegate authority you
// do not have, so the list is built from the delegator's own role: the step
// they staff in the chain, and whatever their role is granted in the access
// matrix.
//
// Deliberately their OWN role only — never powers they hold because somebody
// delegated to them. Re-delegating a delegation builds a chain nobody can
// follow, and the copy would outlive the handover it came from.
async function delegatableScopesFor(userId) {
  const empty = { role: null, scopes: [], ownStage: null, ownStageLabel: null };
  try {
    const userRes = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return empty;
    const role = userRes.rows[0].role;

    let matrix = null;
    const settings = await pool.query("SELECT config_data FROM system_settings WHERE setting_key = 'access_matrix'");
    if (settings.rows.length > 0) {
      const raw = settings.rows[0].config_data;
      matrix = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    const own = (matrix && matrix[role]) || {};

    const step = await stepForRole(role);
    const scopes = [];
    if (step) scopes.push('approvals');
    // A matrix saved before 'add' was split from 'edit' has no 'add' key;
    // read it as 'edit' so the role keeps what it had until an administrator
    // sets the two apart.
    if (own.add === undefined ? !!own.edit : !!own.add) scopes.push('add');
    if (own.edit) scopes.push('edit');
    if (own.delete) scopes.push('delete');
    if (own.download) scopes.push('download');

    return {
      role,
      scopes,
      ownStage: step ? step.key : null,
      ownStageLabel: step ? step.label : null,
    };
  } catch (err) {
    console.error('Could not resolve delegatable scopes:', err.message);
    return empty;
  }
}

// --- WHAT I MAY HAND OVER ---
app.get('/api/delegations/delegatable', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    res.json(await delegatableScopesFor(userId));
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// What this person may do right now: their own role's permissions from the
// access matrix, plus anything currently delegated to them.
//
// Delegation grants PERMISSIONS, never the delegator's role behaviour. A
// Department Head delegating "download" lets the stand-in press Download — it
// does not give them fee-free direct downloads. Otherwise delegating to a
// member would quietly hand out free documents.
async function effectivePermissionsFor(userId) {
  const base = { view: false, add: false, edit: false, delete: false, download: false };
  try {
    const userRes = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return { permissions: base, delegated: [] };
    const role = userRes.rows[0].role;

    let matrix = null;
    const settings = await pool.query("SELECT config_data FROM system_settings WHERE setting_key = 'access_matrix'");
    if (settings.rows.length > 0) {
      const raw = settings.rows[0].config_data;
      matrix = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    const own = (matrix && matrix[role]) || {};
    const permissions = {
      view: !!own.view,
      // Missing 'add' means a matrix saved before the split — fall back to
      // 'edit' so nobody silently loses it.
      add: own.add === undefined ? !!own.edit : !!own.add,
      edit: !!own.edit, delete: !!own.delete, download: !!own.download,
    };

    // Delegated scopes are additive — a stand-in never loses their own rights.
    //
    // Each one is re-checked against what the DELEGATOR still holds, not just
    // what they held the day they signed it over. Otherwise stripping a
    // permission from a role would leave it alive in every delegation already
    // written, and the matrix would stop meaning anything.
    const delegated = [];
    const stillHolds = new Map(); // one lookup per delegator, not per scope
    for (const d of await activeDelegationsTo(userId)) {
      if (!stillHolds.has(String(d.fromUserId))) {
        stillHolds.set(String(d.fromUserId), (await delegatableScopesFor(d.fromUserId)).scopes);
      }
      const theirs = stillHolds.get(String(d.fromUserId)) || [];
      const granted = [];
      ['add', 'edit', 'delete', 'download'].forEach(scope => {
        if (!hasScope(d, scope) || !theirs.includes(scope)) return;
        permissions[scope] = true;
        granted.push(scope);
      });
      const coversApprovals = hasScope(d, 'approvals') && theirs.includes('approvals');
      if (granted.length > 0 || coversApprovals) {
        delegated.push({
          fromName: d.fromName, roleKey: d.roleKey, endsOn: d.endsOn,
          scopes: [...(coversApprovals ? ['approvals'] : []), ...granted],
        });
      }
    }
    return { role, permissions, delegated };
  } catch (err) {
    console.error('Could not resolve effective permissions:', err.message);
    return { permissions: base, delegated: [] };
  }
}

// --- WHAT THIS PERSON MAY DO RIGHT NOW ---
app.get('/api/permissions/effective', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    res.json(await effectivePermissionsFor(userId));
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- MY DELEGATIONS (both directions) ---
app.get('/api/delegations', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const [mine, covering] = await Promise.all([
      pool.query(
        `SELECT d.*, COALESCE(u.full_name, u.username) AS "toName", u.role AS "toRole",
                (d.revoked_at IS NULL AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on) AS "isActive"
         FROM delegations d LEFT JOIN users u ON u.id = d.to_user_id
         WHERE d.from_user_id = $1 ORDER BY d.starts_on DESC`,
        [userId]
      ),
      pool.query(
        `SELECT d.*, COALESCE(u.full_name, u.username) AS "fromName", u.role AS "fromRole",
                (d.revoked_at IS NULL AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on) AS "isActive"
         FROM delegations d LEFT JOIN users u ON u.id = d.from_user_id
         WHERE d.to_user_id = $1 ORDER BY d.starts_on DESC`,
        [userId]
      ),
    ]);

    // What a delegation says and what it still grants can differ: the giver's
    // role may have lost a permission since. Report both, so the page can show
    // the difference instead of promising something that no longer works.
    const held = new Map();
    const withEffective = async (rows) => Promise.all(rows.map(async row => {
      const stored = Array.isArray(row.scopes) && row.scopes.length ? row.scopes : ['approvals'];
      if (!row.isActive) return { ...row, scopes: stored, effectiveScopes: [], lapsedScopes: [] };
      const key = String(row.from_user_id);
      if (!held.has(key)) held.set(key, (await delegatableScopesFor(row.from_user_id)).scopes);
      const theirs = held.get(key) || [];
      const effective = stored.filter(sc => theirs.includes(sc));
      return {
        ...row,
        scopes: stored,
        effectiveScopes: effective,
        lapsedScopes: stored.filter(sc => !theirs.includes(sc)),
      };
    }));

    const [given, received] = await Promise.all([
      withEffective(mine.rows), withEffective(covering.rows),
    ]);
    res.json({ given, received });
  } catch (err) {
    console.error('Could not list delegations:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- ADMIN VIEW: everything currently in force ---
app.get('/api/delegations/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.id, d.role_key AS "roleKey", d.starts_on AS "startsOn", d.ends_on AS "endsOn", d.reason,
              COALESCE(f.full_name, f.username) AS "fromName",
              COALESCE(t.full_name, t.username) AS "toName"
       FROM delegations d
       LEFT JOIN users f ON f.id = d.from_user_id
       LEFT JOIN users t ON t.id = d.to_user_id
       WHERE d.revoked_at IS NULL AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
       ORDER BY d.ends_on`
    );
    res.json({ delegations: result.rows });
  } catch (err) {
    console.error('Could not list active delegations:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- HAND OVER ---
app.post('/api/delegations', async (req, res) => {
  const { fromUserId, toUserId, startsOn, endsOn, reason, createdBy, scopes } = req.body;
  if (!fromUserId || !toUserId || !startsOn || !endsOn) {
    return res.status(400).json({ message: "fromUserId, toUserId, startsOn and endsOn are all required" });
  }
  // Only the named responsibilities, and at least one of them — an empty
  // delegation hands over nothing and would just confuse everyone.
  const chosen = Array.isArray(scopes)
    ? scopes.filter(sc => DELEGATION_SCOPES.includes(sc))
    : ['approvals'];
  if (chosen.length === 0) {
    return res.status(400).json({ message: "Choose at least one responsibility to hand over" });
  }
  if (String(fromUserId) === String(toUserId)) {
    return res.status(400).json({ message: "You cannot delegate to yourself" });
  }
  if (new Date(endsOn) < new Date(startsOn)) {
    return res.status(400).json({ message: "The end date cannot be before the start date" });
  }
  try {
    const [from, to] = await Promise.all([
      pool.query('SELECT id, role, COALESCE(full_name, username) AS name FROM users WHERE id = $1', [fromUserId]),
      pool.query('SELECT id, role, COALESCE(full_name, username) AS name, status FROM users WHERE id = $1', [toUserId]),
    ]);
    if (from.rows.length === 0) return res.status(404).json({ message: "Your account was not found" });
    if (to.rows.length === 0) return res.status(404).json({ message: "The colleague you chose was not found" });

    const delegator = from.rows[0];

    // You can only hand over what you hold. Checked here and not only in the
    // browser: the page hides what you cannot give, but the rule has to live
    // on the server or it is only a suggestion.
    const mine = await delegatableScopesFor(fromUserId);
    const notMine = chosen.filter(sc => !mine.scopes.includes(sc));
    if (notMine.length > 0) {
      const names = { approvals: 'approvals', add: 'adding records', edit: 'editing records',
                      delete: 'deleting records', download: 'downloading' };
      return res.status(403).json({
        message: mine.scopes.length === 0
          ? `${delegator.role} has nothing to delegate — the role holds no approval step and no permissions.`
          : `You cannot hand over ${notMine.map(sc => names[sc] || sc).join(' or ')} — ${delegator.role} does not have it.`,
      });
    }

    const step = await stepForRole(delegator.role);

    const result = await pool.query(
      `INSERT INTO delegations (from_user_id, to_user_id, role_key, starts_on, ends_on, reason, created_by, scopes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [fromUserId, toUserId, delegator.role, startsOn, endsOn, reason || null, createdBy || fromUserId, chosen]
    );

    const what = chosen.includes('approvals') && step
      ? [step.label, ...chosen.filter(sc => sc !== 'approvals')].join(', ')
      : chosen.join(', ');

    await writeAuditLog(createdBy || fromUserId, 'Duties delegated',
      `${delegator.name} (${delegator.role}) delegated [${what}] to ${to.rows[0].name} from ${startsOn} to ${endsOn}${reason ? ` — ${reason}` : ''}`,
      'warning');
    await writeNotification(toUserId, 'You are covering for a colleague',
      `${delegator.name} has asked you to cover ${what} from ${startsOn} to ${endsOn}.`);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Could not create the delegation:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- END EARLY ---
app.delete('/api/delegations/:id', async (req, res) => {
  const { id } = req.params;
  const { actingUserId } = req.body || {};
  try {
    const current = await pool.query('SELECT * FROM delegations WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ message: "Delegation not found" });
    const row = current.rows[0];

    // The person who handed the duties over can take them back; so can an
    // administrator. The delegate cannot quietly extend or end it themselves.
    if (actingUserId && String(row.from_user_id) !== String(actingUserId)) {
      const acting = await pool.query('SELECT role FROM users WHERE id = $1', [actingUserId]);
      const behaviour = acting.rows.length > 0 ? await behaviourOf(acting.rows[0].role) : 'member';
      if (behaviour !== 'administrator') {
        return res.status(403).json({ message: "Only the person who delegated these duties, or an administrator, can end it." });
      }
    }

    await pool.query('UPDATE delegations SET revoked_at = NOW() WHERE id = $1', [id]);
    await writeAuditLog(actingUserId || null, 'Delegation ended', `Delegation #${id} ended early`, 'warning');
    res.json({ success: true });
  } catch (err) {
    console.error('Could not end the delegation:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- WHICH QUEUES THIS PERSON SEES ---
// Replaces the old single-stage lookup: someone covering for a colleague has
// more than one queue, and roles are administrator-defined so the client
// cannot work this out from the role name.
app.get('/api/office-requests/my-stages', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const own = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (own.rows.length === 0) return res.status(404).json({ message: "User not found" });
    const ownRole = own.rows[0].role;

    const steps = await getWorkflowSteps();
    // Their own step only counts if they actually staff it: a step that names
    // specific people does not belong to every colleague who shares the role.
    const ownStep = steps.find(st => staffsStep(st, userId, ownRole)) || null;

    const delegated = [];
    for (const d of await activeDelegationsTo(userId)) {
      if (!hasScope(d, 'approvals')) continue;   // duties handed over, but not approvals
      // Find the delegator's step the same way authority is decided: by the
      // people named on it first, then by role. Looking only at the role used
      // to lose the queue entirely when a step named people and had no role.
      const step = steps.find(st => staffsStep(st, d.fromUserId, d.roleKey));
      if (step) {
        delegated.push({
          stage: step.key, stageLabel: step.label, role: d.roleKey,
          fromName: d.fromName, endsOn: d.endsOn,
        });
      }
    }

    res.json({
      role: ownRole,
      ownStage: ownStep ? ownStep.key : null,
      ownStageLabel: ownStep ? ownStep.label : null,
      delegated,
      // every queue this person can work, own first
      stages: [...(ownStep ? [ownStep.key] : []), ...delegated.map(d => d.stage)],
    });
  } catch (err) {
    console.error('Could not resolve queues:', err.message);
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
    const stages = await resolveChainStages();
    res.json({ stage: stages[idx] });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- WHO STAFFS ONE PARTICULAR STEP ---
// Used when a reviewer accepts and has to forward to the next step. That
// picker used to list everyone holding the next step's role, which named
// nobody useful once a step belonged to named people instead.
app.get('/api/workflow/step-staff', async (req, res) => {
  const { stepKey } = req.query;
  if (!stepKey) return res.status(400).json({ message: "stepKey is required" });
  try {
    const steps = await getWorkflowSteps({ includeHidden: true });
    const step = steps.find(s => s.key === stepKey);
    if (!step) return res.status(404).json({ message: "No such step" });
    res.json({
      stage: step.key,
      stageLabel: step.label,
      namedOnStep: Array.isArray(step.userIds) && step.userIds.length > 0,
      staff: await peopleForStep(step),
    });
  } catch (err) {
    console.error('Could not resolve step staff:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- WHO WILL REVIEW WHAT I AM ABOUT TO SUBMIT ---
// The "send to" picker used to guess from the maker's role with the three
// original job titles hard-coded in the client, so renaming a role emptied it.
// This answers from the live workflow instead: the first step the request will
// actually land on, and the people who staff that step by name.
app.get('/api/office-requests/next-reviewers', async (req, res) => {
  const { userId, action, bookId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const userRes = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ message: "User not found" });
    const me = userRes.rows[0];

    const stages = await resolveChainStages();
    const steps = await getWorkflowSteps({ includeHidden: true });
    const act = String(action || 'download').toLowerCase();

    let chain;
    if (act === 'download') {
      // Downloads are routed by the document's classification.
      let securityClass = 'normal';
      if (bookId) {
        const b = await pool.query('SELECT security_class FROM books WHERE id = $1', [bookId]);
        if (b.rows.length > 0 && b.rows[0].security_class) securityClass = b.rows[0].security_class;
      }
      const behaviour = await behaviourOf(me.role);
      if (behaviour === 'staff_maker') {
        // Staff makers go to the step after their own, so they never review
        // what they raised.
        const mine = await ownStepIndexIn(stages, me.id, me.role);
        const next = (mine !== -1 && mine + 1 < stages.length) ? stages[mine + 1] : stages[0];
        chain = next ? [next] : [];
      } else {
        chain = await chainForClass(securityClass);
      }
    } else {
      chain = await chainForAction(act);
    }

    // Drop the maker's own step and anything before it — same rule the submit
    // endpoints apply, so the picker cannot offer somebody who will then be
    // refused for deciding their own request.
    const mineIdx = await ownStepIndexIn(stages, me.id, me.role);
    if (mineIdx !== -1) {
      const skipUpTo = stages.slice(0, mineIdx + 1);
      chain = chain.filter(k => !skipUpTo.includes(k));
    }

    const firstKey = chain.length > 0 ? chain[0] : null;
    const step = firstKey ? steps.find(s => s.key === firstKey) : null;
    const reviewers = await peopleForStep(step);

    res.json({
      stage: firstKey,
      stageLabel: step ? step.label : null,
      // Only informational now — the picker lists people, not a role.
      stageRole: step ? (step.roleKey || null) : null,
      namedOnStep: Array.isArray(step?.userIds) && step.userIds.length > 0,
      reviewers,
    });
  } catch (err) {
    console.error('Could not resolve next reviewers:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- SUBMIT PERMISSION CHANGE (add/edit/delete a record) — always the full 3-step chain ---
app.post('/api/office-requests', upload.single('pdfFile'), async (req, res) => {
  const { makerId, requestType, requestedPermission, targetLabel, targetBookId, reason, metaContext, assignedReviewerId } = req.body;

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
    if (req.file) contextPayload.file_path = await fileStore.saveUpload(req.file);

    const requestCode = await nextRequestCode();
    const action = `Permission: ${requestedPermission}`;

    // The steps THIS action needs, not the whole chain. An administrator can
    // decide that adding a record needs nobody, editing needs one reviewer and
    // deleting needs three — this reads that setting.
    let chain = await chainForAction(requestedPermission);

    // A maker never reviews their own request, so anything up to and including
    // their own position in the chain is dropped. Their position comes from who
    // staffs each step (the people named on it, then its role), so somebody
    // named on a step is skipped past it whatever their job title is.
    const allStages = await resolveChainStages();
    const makerStepIndex = await ownStepIndexIn(allStages, maker.id, maker.role);
    if (makerStepIndex !== -1) {
      const skipUpTo = allStages.slice(0, makerStepIndex + 1);
      chain = chain.filter(k => !skipUpTo.includes(k));
    }

    const initialStage = chain.length > 0 ? chain[0] : 'approved';

    const result = await pool.query(
      `INSERT INTO approval_requests
         (request_code, action, target_label, target_book_id, reason, stage, requested_by, request_type, requested_permission, maker_full_name, maker_username, meta_context, assigned_reviewer_id, required_stages)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
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
        JSON.stringify(contextPayload),
        assignedReviewerId ? parseInt(assignedReviewerId) : null,
        chain
      ]
    );

    // No steps required for this action: carry it out now rather than parking
    // it in a queue nobody staffs. The request row is still written, already
    // approved, so the audit trail shows what happened and who did it.
    if (chain.length === 0) {
      await applyPermissionChange(result.rows[0]);
      await writeAuditLog(makerId, 'Applied without approval',
        `${requestCode} — ${action}: ${targetLabel}. This action needs no approval steps, so it was applied immediately.`,
        'warning');
      return res.json({ ...result.rows[0], appliedImmediately: true });
    }

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
    const workflowSteps = await getWorkflowSteps({ includeHidden: true });
    // step key -> role responsible, for however many steps exist.
    const settingsMap = {};
    workflowSteps.forEach(st => { settingsMap[st.key] = st.roleKey; });

    let targetedStage = stage;

    if (reviewerRole) {
      const idx = chainRoles.indexOf(reviewerRole);
      if (idx !== -1) {
        const stages = await resolveChainStages();
        targetedStage = stages[idx];
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
        ar.assigned_reviewer_id AS "assignedReviewerId",
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
// Carry out the change a permission request asked for: insert, update or
// delete the record it describes.
//
// Extracted from the accept handler so the no-approval case can use exactly
// the same code. When an action's chain is empty the change is applied the
// moment it is submitted, and a second copy of this logic is how the two paths
// would quietly drift apart.
async function applyPermissionChange(reqRow) {
      // A request with no staged payload at all — an older row, or one written
      // outside the submit endpoint — used to throw on the first property read
      // and the whole approval returned a 500 after the decision had already
      // been recorded.
      const raw = typeof reqRow.meta_context === 'string' ? JSON.parse(reqRow.meta_context) : reqRow.meta_context;
      const data = raw || {};

      if (reqRow.requested_permission === 'add') {
        await pool.query(
          `INSERT INTO books (title, author, department, location, published_year, page_count, file_path, uploaded_by, security_class,
                               category, report_topic, map_type, map_format, scale, subject, call_number, pub_type, classification)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [
            data.title, data.author, data.department, data.location, parseInt(data.published_year) || null, pageCountOrNull(data.page_count),
            data.file_path || null, reqRow.requested_by, data.security_class || 'normal',
            data.category || null, data.reportTopic || null, data.mapType || null, data.mapFormat || null, data.scale || null,
            data.subject || null, data.call_number || null, data.pubType || null, data.classification || null
          ]
        );
      } else if (reqRow.requested_permission === 'edit') {
        if (data.file_path) {
          await pool.query(
            `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6, file_path=$7, security_class=$8,
                    category=$9, report_topic=$10, map_type=$11, map_format=$12, scale=$13, subject=$14, call_number=$15, pub_type=$16, updated_at=NOW() WHERE id=$17`,
            [
              data.title, data.author, data.department, data.location, parseInt(data.published_year) || null, pageCountOrNull(data.page_count),
              data.file_path, data.security_class || 'normal',
              data.category || null, data.reportTopic || null, data.mapType || null, data.mapFormat || null, data.scale || null,
              data.subject || null, data.call_number || null, data.pubType || null,
              reqRow.target_book_id
            ]
          );
        } else {
          await pool.query(
            `UPDATE books SET title=$1, author=$2, department=$3, location=$4, published_year=$5, page_count=$6, security_class=$7,
                    category=$8, report_topic=$9, map_type=$10, map_format=$11, scale=$12, subject=$13, call_number=$14, pub_type=$15, updated_at=NOW() WHERE id=$16`,
            [
              data.title, data.author, data.department, data.location, parseInt(data.published_year) || null, pageCountOrNull(data.page_count),
              data.security_class || 'normal',
              data.category || null, data.reportTopic || null, data.mapType || null, data.mapFormat || null, data.scale || null,
              data.subject || null, data.call_number || null, data.pubType || null,
              reqRow.target_book_id
            ]
          );
        }
      } else if (reqRow.requested_permission === 'delete') {
        await pool.query('DELETE FROM books WHERE id = $1', [reqRow.target_book_id]);
      }
      await writeAuditLog(reqRow.requested_by, 'Execution Complete', `Staging modification metrics updated successfully for action: ${reqRow.requested_permission}`, 'success');
}

app.put('/api/office-requests/:id/accept', async (req, res) => {
  const { id } = req.params;
  const { actingUserId, nextReviewerId } = req.body;
  if (!actingUserId) return res.status(400).json({ message: "actingUserId is required" });

  try {
    const current = await pool.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ message: "Request not found" });
    const reqRow = current.rows[0];

    // A request carries the chain it was created with, so editing the
    // workflow afterwards never changes a decision already in flight.
    const chain = (reqRow.required_stages && reqRow.required_stages.length > 0)
      ? reqRow.required_stages
      : await resolveChainStages();

    const actingUserResult = await pool.query('SELECT role FROM users WHERE id = $1', [actingUserId]);
    if (actingUserResult.rows.length === 0) return res.status(404).json({ message: "Acting user not found" });
    const actingUserRole = actingUserResult.rows[0].role;

    if (!chain.includes(reqRow.stage)) {
      return res.status(409).json({ message: `Already in terminal or unrelated stage: ${reqRow.stage}` });
    }
    if (reqRow.requested_by === parseInt(actingUserId)) {
      return res.status(403).json({ message: "Segregation of duties rule violation: Maker cannot verify their own request" });
    }

    // Who staffs the step this request is sitting on, looked up from the
    // workflow rather than a fixed three-way map. People named on the step
    // decide it; the role is only the fallback when nobody is named.
    const workflowSteps = await getWorkflowSteps({ includeHidden: true });
    const stepHere = workflowSteps.find(st => st.key === reqRow.stage);
    const authority = await authorityForStep(stepHere, actingUserId, actingUserRole);
    if (!authority.ok) {
      return res.status(authority.unassigned ? 409 : 403).json({ message: authority.message });
    }
    const coveringRole = authority.coveringRole;
    // Recorded for the audit trail only. A step assigned to people need not
    // have a role at all, so fall back to whatever the actor actually holds.
    const expectedRoleForStage = (stepHere && stepHere.roleKey) || actingUserRole || null;

    // If the maker addressed this request to one named person, only they — or
    // whoever is covering for them while they are away — can act on it.
    if (reqRow.assigned_reviewer_id && String(reqRow.assigned_reviewer_id) !== String(actingUserId)) {
      const coveringPerson = await delegationForUser(actingUserId, reqRow.assigned_reviewer_id);
      if (!coveringPerson) {
        return res.status(403).json({ message: "This request was sent to a specific reviewer — only they, or whoever is covering for them, can act on it." });
      }
    }

    const currentIdx = chain.indexOf(reqRow.stage);
    const isFinalStep = currentIdx === chain.length - 1;
    const nextStage = isFinalStep ? 'approved' : chain[currentIdx + 1];

    // The original three columns only ever held three decisions, so who acted
    // is recorded in approval_steps. The old columns are still filled for the
    // first three steps, so anything still reading them keeps working.
    const LEGACY_COLUMN = { officer: 'officer_id', senior_officer: 'checker_id', authorizer: 'authorizer_id' };
    const idColumn = LEGACY_COLUMN[reqRow.stage] || null;

    // Forwarding assignment: when moving to the next stage the accepting
    // reviewer picks the specific next person; once approved (final), the
    // assignment is cleared.
    const nextAssignee = nextStage === 'approved'
      ? null
      : (nextReviewerId ? parseInt(nextReviewerId) : null);
    const values = [nextStage, nextAssignee, id];
    const legacySet = idColumn ? `, ${idColumn} = $${values.push(actingUserId)}` : '';
    const result = await pool.query(
      `UPDATE approval_requests
          SET stage = $1, assigned_reviewer_id = $2, updated_at = NOW()${legacySet}
        WHERE id = $3 RETURNING *`,
      values
    );
    // An institution needs to see who really pressed it, so a decision taken
    // under delegation says so rather than appearing as the absent person.
    const onBehalf = coveringRole ? ` on behalf of ${coveringRole.fromName}` : '';
    await pool.query(
      `INSERT INTO approval_steps (request_id, step_key, step_order, role_key, acted_by, action, reason)
       VALUES ($1,$2,$3,$4,$5,'accepted',$6)`,
      [reqRow.id, reqRow.stage, currentIdx, expectedRoleForStage, actingUserId,
       coveringRole ? `Acted under delegation from ${coveringRole.fromName}` : null]
    );
    const roleLabel = await labelForStage(reqRow.stage);
    await writeAuditLog(actingUserId, `Office Chain: ${roleLabel} Verified`,
      `Request ${reqRow.request_code} advanced from '${reqRow.stage}' to '${nextStage}'${onBehalf}`, 'info');

    if (nextStage === 'approved') {
      if (reqRow.request_type === 'download') {
        // Officer makers have payment pre-cleared — they can download right
        // away. Regular users still pay first.
        const alreadyCleared = reqRow.payment_status === 'paid';
        await writeNotification(
          reqRow.requested_by,
          'Download request accepted',
          alreadyCleared
            ? `${reqRow.request_code} — all approvals are complete. You can now download "${reqRow.target_label}" by clicking Download again.`
            : `${reqRow.request_code} — all approvals are complete. Pay ${reqRow.total_fee} ETB and you can download "${reqRow.target_label}".`,
          reqRow.id
        );
        await writeAuditLog(reqRow.requested_by, alreadyCleared ? 'Approved — Ready to Download' : 'Approved — Awaiting Payment', `${reqRow.request_code} approved, total fee: ${reqRow.total_fee}`, 'success');
      } else if (reqRow.request_type === 'permission') {
        await applyPermissionChange(reqRow);
        const doneMessages = {
          add:    `${reqRow.request_code} — all approvals are complete. Your new record "${reqRow.target_label}" has been added to the library.`,
          edit:   `${reqRow.request_code} — all approvals are complete. Your changes to "${reqRow.target_label}" have been applied.`,
          delete: `${reqRow.request_code} — all approvals are complete. "${reqRow.target_label}" has been deleted.`,
        };
        await writeNotification(
          reqRow.requested_by,
          'Request accepted',
          doneMessages[reqRow.requested_permission] || `${reqRow.request_code} — all approvals are complete. "${reqRow.target_label}" was approved and applied.`,
          reqRow.id
        );
      }
    } else {
      await writeNotification(
        reqRow.requested_by,
        'Request stage update',
        `${reqRow.request_code} — "${reqRow.target_label}" passed ${await labelForStage(reqRow.stage)} and is now at ${await labelForStage(nextStage)}.`,
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

    const chain = (reqRow.required_stages && reqRow.required_stages.length > 0)
      ? reqRow.required_stages
      : await resolveChainStages();

    if (!chain.includes(reqRow.stage)) {
      return res.status(409).json({ message: `Cannot reject request from current stage: ${reqRow.stage}` });
    }

    // Authority check. This endpoint previously accepted ANY userId, so
    // anyone signed in could reject anyone's request at any stage — the
    // accept side was guarded but this one was not.
    const actingUserResult = await pool.query('SELECT role FROM users WHERE id = $1', [actingUserId]);
    if (actingUserResult.rows.length === 0) return res.status(404).json({ message: "Acting user not found" });
    const actingUserRole = actingUserResult.rows[0].role;

    const workflowSteps = await getWorkflowSteps({ includeHidden: true });
    const stepHere = workflowSteps.find(st => st.key === reqRow.stage);
    // Same rule as accept, from the same helper, so the two cannot drift.
    const authority = await authorityForStep(stepHere, actingUserId, actingUserRole);
    if (!authority.ok) {
      return res.status(authority.unassigned ? 409 : 403).json({ message: authority.message });
    }
    const coveringRole = authority.coveringRole;
    const expectedRoleForStage = (stepHere && stepHere.roleKey) || actingUserRole || null;
    if (reqRow.requested_by === parseInt(actingUserId)) {
      return res.status(403).json({ message: "You cannot decide on your own request." });
    }
    if (reqRow.assigned_reviewer_id && String(reqRow.assigned_reviewer_id) !== String(actingUserId)) {
      const coveringPerson = await delegationForUser(actingUserId, reqRow.assigned_reviewer_id);
      if (!coveringPerson) {
        return res.status(403).json({ message: "This request was sent to a specific reviewer — only they, or whoever is covering for them, can act on it." });
      }
    }
    const onBehalf = coveringRole ? ` on behalf of ${coveringRole.fromName}` : '';

    const cleanReason = rejectReason.trim();

    // The first three steps still fill their original columns; every step,
    // including ones the administrator added, is recorded in approval_steps.
    // Previously a stage outside the three left updateQuery undefined and the
    // request crashed on pool.query(undefined).
    const LEGACY_REJECT = {
      officer:        ['officer_id', 'officer_reject_reason'],
      senior_officer: ['checker_id', 'senior_officer_reject_reason'],
      authorizer:     ['authorizer_id', 'dept_head_reject_reason'],
    };
    const legacy = LEGACY_REJECT[reqRow.stage];
    const values = [id];
    const legacySet = legacy
      ? `, ${legacy[0]} = $${values.push(actingUserId)}, ${legacy[1]} = $${values.push(cleanReason)}`
      : '';
    const result = await pool.query(
      `UPDATE approval_requests SET stage = 'rejected', updated_at = NOW()${legacySet}
        WHERE id = $1 RETURNING *`,
      values
    );
    await pool.query(
      `INSERT INTO approval_steps (request_id, step_key, step_order, role_key, acted_by, action, reason)
       VALUES ($1,$2,$3,$4,$5,'rejected',$6)`,
      [reqRow.id, reqRow.stage, chain.indexOf(reqRow.stage), expectedRoleForStage, actingUserId,
       coveringRole ? `${cleanReason} (under delegation from ${coveringRole.fromName})` : cleanReason]
    );
    await writeAuditLog(actingUserId, 'Office Request Rejected',
      `Request ${reqRow.request_code} rejected at stage '${reqRow.stage}'${onBehalf}: ${cleanReason}`, 'danger');
    // The maker is told the outcome only — never the rejection reason
    // (it stays in the audit log and the request record for reviewers).
    await writeNotification(reqRow.requested_by, 'Request rejected', `${reqRow.request_code} — "${reqRow.target_label}" was not approved.`, reqRow.id);

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    return res.status(500).send("Server Error");
  }
});

// ============================================================================
// 11. SECURITY-CLASSED DOWNLOAD + PAYMENT PIPELINE
// ============================================================================


// ============================================================================
// SELF-SERVICE ALLOWANCE
//
// A regular User gets a few downloads each calendar month that they can take
// themselves — pay the per-page fee and download. Past that, an Officer has to
// authorise each one first.
//
// The month is a CALENDAR month, so the allowance renews on the 1st without
// anyone resetting anything. Counting is done on download_events, i.e. files
// actually delivered: a request that was abandoned before payment should not
// burn someone's allowance.
// ============================================================================
const DEFAULT_SELF_SERVICE_PER_MONTH = 2;

// Zero is a real setting for both of these — "every download needs approval"
// — so they are read with Number(), never `||`, which would turn a deliberate
// 0 back into the default. A null per-day limit means no daily cap at all,
// which is different again from a cap of 0.
async function getDownloadPolicy() {
  const fallback = {
    selfServicePerMonth: DEFAULT_SELF_SERVICE_PER_MONTH,
    selfServicePerDay: null,
  };
  try {
    const res = await pool.query(
      "SELECT config_data FROM system_settings WHERE setting_key = 'download_policy'"
    );
    if (res.rows.length === 0) return fallback;
    const data = res.rows[0].config_data;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    const month = Number(parsed.selfServicePerMonth);
    const day = parsed.selfServicePerDay === null || parsed.selfServicePerDay === undefined
      || parsed.selfServicePerDay === ''
      ? null
      : Number(parsed.selfServicePerDay);

    return {
      selfServicePerMonth: Number.isFinite(month) && month >= 0 ? month : fallback.selfServicePerMonth,
      selfServicePerDay: Number.isFinite(day) && day >= 0 ? day : null,
    };
  } catch (err) {
    console.error('Could not read the download policy, using the defaults:', err.message);
    return fallback;
  }
}

async function getSelfServiceLimit() {
  return (await getDownloadPolicy()).selfServicePerMonth;
}

// How much of this month's allowance a user has left.
async function getAllowance(userId) {
  const policy = await getDownloadPolicy();

  // Both windows in one query, counted by the server's own clock — the same
  // clock date_trunc uses, so the two can never disagree.
  const res = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS used_month,
       COUNT(*) FILTER (WHERE created_at >= date_trunc('day',   NOW()))::int AS used_today
     FROM download_events
     WHERE user_id = $1`,
    [userId]
  );
  const usedMonth = res.rows[0].used_month;
  const usedToday = res.rows[0].used_today;

  const limit = policy.selfServicePerMonth;
  const remaining = Math.max(limit - usedMonth, 0);

  const dailyLimit = policy.selfServicePerDay;
  const remainingToday = dailyLimit === null ? null : Math.max(dailyLimit - usedToday, 0);

  // Whichever window runs out first is the one that bites. A daily cap of 3
  // inside a monthly 20 means the fourth download today waits for an officer
  // even though nineteen remain this month.
  const needsApproval = remaining <= 0 || (remainingToday !== null && remainingToday <= 0);

  const resetsOn = new Date();
  resetsOn.setMonth(resetsOn.getMonth() + 1, 1);
  resetsOn.setHours(0, 0, 0, 0);

  const resetsToday = new Date();
  resetsToday.setDate(resetsToday.getDate() + 1);
  resetsToday.setHours(0, 0, 0, 0);

  return {
    limit, used: usedMonth, remaining,
    dailyLimit, usedToday, remainingToday, resetsToday,
    // Which cap stopped them, so the screen can say "today" rather than a
    // monthly message that reads as wrong when nineteen are left.
    blockedBy: remainingToday !== null && remainingToday <= 0 ? 'day'
             : remaining <= 0 ? 'month' : null,
    needsApproval, resetsOn,
  };
}

// --- WHAT IS LEFT THIS MONTH (the user dashboard reads this) ---
app.get('/api/downloads/allowance', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found" });

    // Only member-behaviour roles have an allowance. Staff either download
    // directly or go through the chain, so a number for them would mislead.
    if (await behaviourOf(userResult.rows[0].role) !== 'member') {
      return res.json({ applies: false, role: userResult.rows[0].role });
    }
    res.json({ applies: true, ...(await getAllowance(userId)) });
  } catch (err) {
    console.error('Allowance lookup failed:', err.message);
    res.status(500).send("Server Error");
  }
});

// --- ADMIN: how many self-service downloads a user gets per month ---
app.get('/api/settings/download-policy', async (req, res) => {
  try {
    res.json(await getDownloadPolicy());
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: `Could not read the download policy: ${err.message}` });
  }
});

app.put('/api/settings/download-policy', async (req, res) => {
  const { selfServicePerMonth, selfServicePerDay, changedBy } = req.body;
  const limit = Number(selfServicePerMonth);
  if (!Number.isFinite(limit) || limit < 0) {
    return res.status(400).json({ message: "selfServicePerMonth must be 0 or more" });
  }
  // Blank or null means no daily cap, which is not the same as a cap of 0.
  const noDaily = selfServicePerDay === null || selfServicePerDay === undefined || selfServicePerDay === '';
  const perDay = noDaily ? null : Number(selfServicePerDay);
  if (!noDaily && (!Number.isFinite(perDay) || perDay < 0)) {
    return res.status(400).json({ message: "selfServicePerDay must be 0 or more, or left blank for no daily limit" });
  }
  if (perDay !== null && perDay > limit) {
    return res.status(400).json({
      message: `A daily limit of ${perDay} is higher than the monthly limit of ${limit}, so it would never apply. Raise the monthly limit or lower the daily one.`,
    });
  }
  try {
    await pool.query(
      `INSERT INTO system_settings (setting_key, config_data, updated_at)
       VALUES ('download_policy', $1, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET config_data = $1, updated_at = NOW()`,
      [JSON.stringify({ selfServicePerMonth: limit, selfServicePerDay: perDay })]
    );
    await writeAuditLog(changedBy, 'Download policy updated',
      `Users may take ${limit} download${limit === 1 ? '' : 's'} per month` +
      `${perDay === null ? ' (no daily limit)' : `, at most ${perDay} per day`} without authorisation`,
      'warning');
    res.json({ selfServicePerMonth: limit, selfServicePerDay: perDay });
  } catch (err) {
    console.error('Could not save the download policy:', err.message);
    res.status(500).json({ message: `Could not save the download policy: ${err.message}` });
  }
});

// --- QUOTE: what will this download cost, and does it need approval first? ---
app.post('/api/downloads/initiate', async (req, res) => {
  const { bookId, userId } = req.body;
  if (!bookId) return res.status(400).json({ message: "bookId is required" });
  try {
    const bookResult = await pool.query('SELECT id, title, page_count, security_class, category FROM books WHERE id = $1', [bookId]);
    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
    const book = bookResult.rows[0];

    const fees = await getCategoryFees();
    const securityClass = book.security_class || 'normal';
    const feePerPage = feeForCategory(fees, book.category);
    // No invented default. The fee is pages x rate, so guessing the pages
    // means charging the wrong amount — and a guess of 12 made every document
    // in a category cost exactly the same.
    const pageCount = pageCountOrNull(book.page_count);
    if (pageCount === null && feePerPage > 0) {
      return res.status(409).json({
        message: `"${book.title}" has no page count recorded, so its fee cannot be worked out. An administrator can set it by editing the record.`,
        needsPageCount: true,
      });
    }
    const totalFee = +(feePerPage * (pageCount || 0)).toFixed(2);

    // Whether approval is needed depends on who is asking, not on the
    // document: a User inside their monthly allowance pays and goes, past it
    // an Officer has to authorise first.
    let requiresApproval = (await chainForClass(securityClass)).length > 0;
    let allowance = null;
    if (userId) {
      const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length > 0 && await behaviourOf(userResult.rows[0].role) === 'member') {
        allowance = await getAllowance(userId);
        requiresApproval = allowance.needsApproval;
      }
    }

    res.json({
      bookId: book.id,
      title: book.title,
      securityClass,
      pageCount,
      feePerPage,
      totalFee,
      requiresApproval,
      allowance,
      approvalChain: requiresApproval ? ['officer'] : [],
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// --- SUBMIT A DOWNLOAD REQUEST (normal docs land straight on 'approved';
//   --- medium/strict start their approval chain) ---
app.post('/api/downloads/request', async (req, res) => {
  const { bookId, userId, reason, assignedReviewerId } = req.body;
  if (!bookId || !userId) return res.status(400).json({ message: "bookId and userId are required" });

  try {
    const bookResult = await pool.query('SELECT * FROM books WHERE id = $1', [bookId]);
    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
    const book = bookResult.rows[0];

    const makerResult = await pool.query('SELECT id, full_name, username, role FROM users WHERE id = $1', [userId]);
    if (makerResult.rows.length === 0) return res.status(404).json({ message: "User not found" });
    const maker = makerResult.rows[0];

    const securityClass = book.security_class || 'normal';

    // Who routes where:
    //   Officer   → straight to the Senior Officer (checker), pays nothing,
    //               never reaches the authorizer/Department Head.
    //   User      → inside this month's allowance, the request is approved on
    //               the spot and they just pay. Past the allowance, an Officer
    //               must authorise it first.
    //   anyone else → the usual chain for the document's class.
    const chainRoles = await resolveChainRoles();
    const stages = await resolveChainStages();
    const behaviour = await behaviourOf(maker.role);
    const isPlainUser = behaviour === 'member';

    // A staff_maker asks whoever staffs the step AFTER their own, so the
    // person who raised it is never the person who accepts it. If they staff
    // no step, or theirs is the last one, it goes to the first step.
    //
    // Their own step is found by who staffs it — named people first, role as
    // the fallback — not by role alone. By role alone, somebody named on a
    // role-less step looked like they staffed nothing, and their request was
    // routed to their own step, where the segregation-of-duties rule then
    // stopped anyone from deciding it.
    let ownStepIndex = await ownStepIndexIn(stages, maker.id, maker.role);
    if (ownStepIndex === -1) ownStepIndex = chainRoles.indexOf(maker.role);
    const isStaffMaker = behaviour === 'staff_maker';
    const nextStage = (ownStepIndex !== -1 && ownStepIndex + 1 < stages.length)
      ? stages[ownStepIndex + 1]
      : stages[0];

    // Re-checked here, not trusted from the quote: the client could post
    // straight to this endpoint and claim it was within allowance.
    const allowance = isPlainUser ? await getAllowance(userId) : null;

    let chain;
    if (isStaffMaker) chain = nextStage ? [nextStage] : [];
    else if (isPlainUser) chain = allowance.needsApproval ? await chainForClass(securityClass) : [];
    else chain = await chainForClass(securityClass);

    // A reason is what the officer reads when deciding, so it is only
    // required when somebody actually has to decide.
    if (chain.length > 0 && (!reason || !reason.trim())) {
      return res.status(400).json({ message: "A reason is required for download requests" });
    }

    const fees = await getCategoryFees();
    const feePerPage = isStaffMaker ? 0 : feeForCategory(fees, book.category);
    const pageCount = pageCountOrNull(book.page_count);
    if (pageCount === null && feePerPage > 0) {
      return res.status(409).json({
        message: `"${book.title}" has no page count recorded, so its fee cannot be worked out. An administrator can set it by editing the record.`,
        needsPageCount: true,
      });
    }
    const totalFee = isStaffMaker ? 0 : +(feePerPage * pageCount).toFixed(2);

    const requestCode = await nextRequestCode();
    const initialStage = chain.length > 0 ? chain[0] : 'approved';

    const result = await pool.query(
      `INSERT INTO approval_requests
         (request_code, action, target_label, target_book_id, reason, stage, requested_by, request_type,
          maker_full_name, maker_username, security_class, required_stages, fee_per_page, page_count_snapshot,
          total_fee, payment_status, meta_context, assigned_reviewer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'download',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        requestCode, 'Download', `Download Document: ${book.title}`, book.id,
        (reason || '').trim() || 'Self-service download within the monthly allowance',
        initialStage, userId, maker.full_name, maker.username, securityClass, chain,
        feePerPage, pageCount, totalFee,
        isStaffMaker ? 'paid' : 'unpaid', // staff makers never pay — mark cleared so the file gate opens on acceptance
        JSON.stringify({ file_path: book.file_path }),
        assignedReviewerId ? parseInt(assignedReviewerId) : null
      ]
    );

    if (chain.length === 0) {
      await writeAuditLog(userId, 'Download Requested',
        `${requestCode} — ${book.title} (self-service, ${allowance ? allowance.used + 1 : 1} of ${allowance ? allowance.limit : '?'} this month)`, 'info');
    } else {
      await writeAuditLog(userId, 'Download Requested',
        `${requestCode} — ${book.title} routed to [${initialStage}]${allowance && allowance.needsApproval ? ' (monthly allowance used up)' : ` (${securityClass})`}`, 'warning');
    }

    // The client needs to know which of the two paths this took, so it can
    // either open the payment step or say "waiting for the officer".
    res.json({ ...result.rows[0], selfService: chain.length === 0, allowance });
  } catch (err) {
    console.error("Download request pipeline error:", err.message);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// --- PAY FOR AN APPROVED DOWNLOAD ---
// Payment methods offered at checkout.
//
// DEMO ONLY. Confirming here marks the download paid; nothing is verified
// against telebirr or CBE, because that needs merchant credentials and signed
// API calls from their side. The amounts recorded are real, so the download
// report and revenue figures are correct — but anyone who clicks Confirm gets
// the document. Before this faces real users, this endpoint must either call
// the gateway for real or hold the download until a finance officer confirms
// the transaction reference.
const PAYMENT_METHODS = {
  telebirr: 'telebirr',
  cbe: 'CBE Birr',
};

// Which columns the payments table actually has, read once at startup. The
// table is not created by this file on an existing database, so its column
// NAMES vary: one install calls the rate `fee_per_page`, another
// `price_per_page`. Writing a fixed list of names fails on anything else, and
// a NOT NULL column we skipped reports a name that appears nowhere in this
// code ("null value in column price_per_page").
let paymentColumns = new Set();

async function readPaymentColumns() {
  try {
    const res = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='payments'"
    );
    paymentColumns = new Set(res.rows.map(r => r.column_name));
    console.log(`payments table columns: ${[...paymentColumns].join(', ') || '(none)'}`);
  } catch (err) {
    console.error('Could not read the payments columns:', err.message);
  }
}

// Every name a given value is known by. The canonical one this code prefers
// comes first; the rest are what other installs call the same thing. Each one
// that exists gets written, so a legacy column is filled rather than left NULL
// — which also keeps any report reading the old name correct.
const PAYMENT_FIELD_ALIASES = {
  request_id:    ['request_id'],
  book_id:       ['book_id'],
  user_id:       ['user_id'],
  page_count:    ['page_count', 'pages'],
  fee_per_page:  ['fee_per_page', 'price_per_page', 'unit_price'],
  total_amount:  ['total_amount', 'amount', 'total'],
  gateway:       ['gateway', 'method', 'channel'],
  reference:     ['reference', 'transaction_ref', 'txn_ref'],
  payer_account: ['payer_account', 'payer', 'account_number'],
  status:        ['status'],
};

// Build an INSERT that uses only the columns this table really has.
function buildPaymentInsert(values) {
  const cols = [];
  const params = [];
  for (const [canonical, aliases] of Object.entries(PAYMENT_FIELD_ALIASES)) {
    if (!(canonical in values)) continue;
    for (const name of aliases) {
      if (paymentColumns.has(name) && !cols.includes(name)) {
        cols.push(name);
        params.push(values[canonical]);
      }
    }
  }
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  return {
    text: `INSERT INTO payments (${cols.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`,
    params,
  };
}

// A phone or account number in the audit log, with the middle hidden. Enough
// to recognise which account paid, not enough to be a leak if the log is
// shared.
function maskAccount(v) {
  const t = String(v || '').trim();
  if (t.length <= 4) return t;
  return `${t.slice(0, 3)}${'•'.repeat(Math.max(t.length - 6, 1))}${t.slice(-3)}`;
}

app.get('/api/payments/methods', (req, res) => {
  res.json({
    demo: true,
    methods: Object.entries(PAYMENT_METHODS).map(([key, label]) => ({ key, label })),
  });
});

app.post('/api/payments/checkout', async (req, res) => {
  const { requestId, userId, gateway, reference, payerAccount } = req.body;
  if (!requestId || !userId) return res.status(400).json({ message: "requestId and userId are required" });
  if (!PAYMENT_METHODS[gateway]) {
    return res.status(400).json({ message: "Choose telebirr or CBE Birr" });
  }

  const client = await pool.connect();
  try {
    const current = await client.query('SELECT * FROM approval_requests WHERE id = $1', [requestId]);
    // NOTE: do NOT call client.release() in these early returns — the
    // finally block below already releases it. Releasing twice makes pg
    // throw "Client has already been released to the pool".
    if (current.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }
    const reqRow = current.rows[0];

    if (reqRow.requested_by !== parseInt(userId)) {
      return res.status(403).json({ message: "Only the requester can pay for this download" });
    }
    if (reqRow.stage !== 'approved') {
      return res.status(409).json({ message: "This request has not been approved yet" });
    }
    if (reqRow.payment_status === 'paid') {
      return res.status(409).json({ message: "This download has already been paid for" });
    }

    await client.query('BEGIN');
    const insert = buildPaymentInsert({
      request_id:    reqRow.id,
      book_id:       reqRow.target_book_id,
      user_id:       userId,
      page_count:    reqRow.page_count_snapshot,
      fee_per_page:  reqRow.fee_per_page,
      total_amount:  reqRow.total_fee,
      gateway,
      reference:     reference ? String(reference).trim().slice(0, 80) : null,
      payer_account: payerAccount ? String(payerAccount).trim().slice(0, 40) : null,
      status:        'completed',
    });
    await client.query(insert.text, insert.params);
    const updated = await client.query(
      `UPDATE approval_requests SET payment_status = 'paid', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [reqRow.id]
    );
    await client.query('COMMIT');

    await writeAuditLog(
      userId, 'Payment Completed',
      `${reqRow.request_code} — paid ${reqRow.total_fee} via ${PAYMENT_METHODS[gateway]} (${reqRow.page_count_snapshot} pages @ ${reqRow.fee_per_page}/page)` +
      `${payerAccount ? ` from ${maskAccount(payerAccount)}` : ''}${reference ? `, ref ${String(reference).trim()}` : ''}`,
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


// ============================================================================
// DOWNLOAD LEDGER
//
// books.download_count is only a running total — no date, no person — and the
// audit log holds free text, so neither can answer "who downloaded what last
// month, and what did we earn". Every delivered file is therefore recorded
// here as one row.
//
// The descriptive columns are SNAPSHOTS taken at download time, on purpose. A
// report about March must keep saying what it said in March, even if someone
// later renames a topic or a map scale. That is the opposite of the live
// labels the library browser shows, and both are right in their own place.
// ============================================================================
async function ensureDownloadLedger() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS download_events (
        id            SERIAL PRIMARY KEY,
        book_id       INTEGER,
        user_id       INTEGER,
        request_id    INTEGER,
        channel       VARCHAR(20),          -- 'paid' | 'staff'
        amount        NUMERIC(10,2) DEFAULT 0,
        page_count    INTEGER,
        fee_per_page  NUMERIC(10,2),
        book_title    TEXT,
        category      VARCHAR(120),
        detail        TEXT,                 -- the classification, spelled out
        user_full_name TEXT,
        user_username  TEXT,
        method        VARCHAR(40),          -- telebirr / cbe, when money was taken
        created_at    TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS download_events_created_idx ON download_events (created_at)');
    await pool.query('ALTER TABLE download_events ADD COLUMN IF NOT EXISTS method VARCHAR(40)');

    // One-time backfill so the report covers money taken before this table
    // existed. payments is the only place with both an amount and a date.
    const existing = await pool.query('SELECT COUNT(*)::int AS n FROM download_events');
    if (existing.rows[0].n === 0) {
      const filled = await pool.query(`
        INSERT INTO download_events
          (book_id, user_id, request_id, channel, amount, page_count, fee_per_page,
           book_title, category, detail, user_full_name, user_username, created_at)
        SELECT p.book_id, p.user_id, p.request_id, 'paid', p.total_amount, p.page_count, p.fee_per_page,
               b.title, b.category,
               -- same shape describeDocument() produces, built in SQL so the
               -- backfilled rows read like the live ones
               NULLIF(concat_ws(' · ',
                 NULLIF(b.report_topic, ''),
                 NULLIF(replace(b.map_type, '_', ' '), ''),
                 NULLIF(b.scale, ''),
                 NULLIF(upper(b.map_format), ''),
                 NULLIF(replace(b.pub_type, '_', ' '), '')
               ), ''),
               u.full_name, u.username, p.created_at
        FROM payments p
        LEFT JOIN books b ON b.id = p.book_id
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.status = 'completed'
      `);
      if (filled.rowCount > 0) {
        console.log(`Download ledger backfilled with ${filled.rowCount} past payment(s)`);
      }
    }
  } catch (err) {
    console.error('Download ledger setup failed:', err.message);
  }
}

// Spells out which part of the library a document sits in, as one readable
// line: the map's scale and type, or the report's topic.
function describeDocument(book) {
  if (!book) return null;
  const bits = [];
  if (book.report_topic) bits.push(book.report_topic);
  if (book.map_type) bits.push(book.map_type.replace(/_/g, ' '));
  if (book.scale) bits.push(book.scale);
  if (book.map_format) bits.push(String(book.map_format).toUpperCase());
  if (book.pub_type) bits.push(book.pub_type.replace(/_/g, ' '));
  if (book.classification) bits.push(book.classification.replace(/_/g, ' '));
  if (book.call_number) bits.push(`Call no. ${book.call_number}`);
  return bits.length ? bits.join(' · ') : null;
}

// Records one delivered file. Never throws: a ledger problem must not stop a
// download the person is already entitled to.
async function recordDownload({ book, user, requestId = null, channel, amount = 0, pageCount = null, feePerPage = null, method = null }) {
  try {
    await pool.query(
      `INSERT INTO download_events
         (book_id, user_id, request_id, channel, amount, page_count, fee_per_page,
          book_title, category, detail, user_full_name, user_username, method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        book?.id || null, user?.id || null, requestId, channel,
        Number(amount) || 0, pageCount, feePerPage,
        book?.title || null, book?.category || null, describeDocument(book),
        user?.full_name || null, user?.username || null, method,
      ]
    );
  } catch (err) {
    console.error('Could not record the download:', err.message);
  }
}

// --- STAFF DIRECT DOWNLOAD: payment applies to the 'User' role only. ---
// Officers, Senior Officers, Department Heads, admin, and manager download
// documents directly — no fee quote, no approval request, no checkout.
// The role check is done server-side so a regular user can't skip payment
// by calling this endpoint directly.
app.get('/api/downloads/direct/:bookId', async (req, res) => {
  const { bookId } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const userResult = await pool.query('SELECT id, username, full_name, role FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ message: "User not found" });
    const requester = userResult.rows[0];
    // Only staff_direct and administrator roles take files without asking.
    const behaviour = await behaviourOf(requester.role);
    if (behaviour !== 'staff_direct' && behaviour !== 'administrator') {
      return res.status(403).json({ message: "Your role must have a request accepted before downloading" });
    }

    // Whole row: the report needs the category columns, not just the file.
    const bookResult = await pool.query('SELECT * FROM books WHERE id = $1', [bookId]);
    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
    const book = bookResult.rows[0];

    await pool.query('UPDATE books SET download_count = download_count + 1 WHERE id = $1', [book.id]);
    await writeAuditLog(userId, 'Downloaded', `${requester.username} (${requester.role}) downloaded "${book.title}" — staff, no fee`, 'info');

    // Staff pay nothing, but the document still has a page count and its
    // category still has a rate — so record both. Leaving them out made every
    // staff download show "—" in the report's Pages column no matter what was
    // entered on the record, and made it impossible to see what a free
    // download would have been worth.
    const fees = await getCategoryFees();
    await recordDownload({
      book,
      user: requester,
      channel: 'staff',
      amount: 0,
      pageCount: pageCountOrNull(book.page_count),
      feePerPage: feeForCategory(fees, book.category),
    });

    return deliverFile(res, book.file_path, { download: true });
  } catch (err) {
    console.error("Staff direct download failed:", err.message);
    res.status(500).send("Server Error");
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

    await pool.query('UPDATE books SET download_count = download_count + 1 WHERE id = $1', [reqRow.target_book_id]);
    await writeAuditLog(userId, 'Downloaded', `${reqRow.request_code} — file delivered`, 'info');

    // Record the sale against this download. The fee is read from the request,
    // which snapshotted it at approval time, so a later price change does not
    // rewrite what was actually charged.
    const [bookRow, userRow] = await Promise.all([
      pool.query('SELECT * FROM books WHERE id = $1', [reqRow.target_book_id]),
      pool.query('SELECT id, username, full_name FROM users WHERE id = $1', [userId]),
    ]);
    // Officers are approved makers who never pay: their request is created
    // with a zero fee and payment_status already 'paid', so no money changed
    // hands. Recording that as a sale would pad the paid-download count with
    // zero-value rows, so the channel follows the amount, not the flag.
    const amountCharged = Number(reqRow.total_fee) || 0;
    // Which method was used lives on the payments row, not the request.
    let method = null;
    if (amountCharged > 0) {
      const pay = await pool.query(
        'SELECT gateway FROM payments WHERE request_id = $1 ORDER BY id DESC LIMIT 1',
        [reqRow.id]
      );
      method = pay.rows[0]?.gateway || null;
    }
    await recordDownload({
      book: bookRow.rows[0],
      user: userRow.rows[0],
      requestId: reqRow.id,
      channel: amountCharged > 0 ? 'paid' : 'free',
      amount: amountCharged,
      pageCount: reqRow.page_count_snapshot,
      feePerPage: reqRow.fee_per_page,
      method,
    });

    return deliverFile(res, filePath, { download: true });
  } catch (err) {
    console.error("Secured download failed:", err.message);
    res.status(500).send("Server Error");
  }
});

// --- PREVIEW LINK for the in-app PDF viewer ---
// Replaces the old open /uploades route: the caller must be a signed-in user,
// and the link it returns expires in 10 minutes. It's a preview, so it is
// deliberately NOT gated on payment — same reach the old viewer had, minus
// the "anyone on the internet with the filename" part.
app.get('/api/books/:id/preview', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return res.status(403).json({ message: "Unknown user" });

    const bookResult = await pool.query('SELECT id, title, file_path FROM books WHERE id = $1', [id]);
    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
    const book = bookResult.rows[0];
    if (!book.file_path) return res.status(404).json({ message: "No file associated with this record" });

    if (!(await fileStore.exists(book.file_path))) {
      return res.status(404).json({ message: "File no longer exists in storage" });
    }

    if (fileStore.isRemote()) {
      const url = await fileStore.getSignedUrl(book.file_path, { download: false });
      return res.json({ url });
    }

    // Disk mode (Bluehost, and local dev). There is no signed-URL service, so
    // point the viewer at a route that re-checks the caller and streams the
    // file inline. Relative on purpose: the frontend is served from this same
    // origin, and Dashboard.js already prefixes a relative url with API.
    return res.json({
      url: `/api/books/${encodeURIComponent(id)}/preview-file?userId=${encodeURIComponent(userId)}`,
    });
  } catch (err) {
    console.error("Preview link failed:", err.message);
    res.status(500).send("Server Error");
  }
});

// --- PREVIEW STREAM (disk mode) ---
// The URL handed out by /preview above. It repeats the permission check
// rather than trusting that the caller came from there, because the browser
// requests this directly — an <object data="..."> tag, not a fetch() the
// frontend controls. Streams inline so the PDF renders in the viewer instead
// of downloading.
app.get('/api/books/:id/preview-file', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) return res.status(403).json({ message: "Unknown user" });

    const bookResult = await pool.query('SELECT file_path FROM books WHERE id = $1', [id]);
    if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });

    return deliverFile(res, bookResult.rows[0].file_path, { download: false });
  } catch (err) {
    console.error("Preview stream failed:", err.message);
    res.status(500).send("Server Error");
  }
});



// --- ONE ACCOUNT, IN FULL ---
// Everything recorded when the account was created, plus what it has done
// since. The download report stores a snapshot of the name at download time,
// so this reads the live account by id — if someone has been renamed since,
// the caller can show both.
app.get('/api/users/:id/profile', async (req, res) => {
  const { id } = req.params;
  try {
    const userResult = await pool.query(
      `SELECT id, username, full_name AS "fullName",
              first_name AS "firstName", middle_name AS "middleName", last_name AS "lastName",
              email, role, department, status,
              created_at AS "createdAt", last_active_at AS "lastActiveAt"
       FROM users WHERE id = $1`,
      [id]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ message: "Account not found" });

    const [activity, requests] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int                     AS downloads,
                COALESCE(SUM(amount), 0)          AS spent,
                MIN(created_at)                   AS "firstDownload",
                MAX(created_at)                   AS "lastDownload"
         FROM download_events WHERE user_id = $1`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int                                          AS total,
                COUNT(*) FILTER (WHERE stage = 'approved')::int        AS approved,
                COUNT(*) FILTER (WHERE stage = 'rejected')::int        AS rejected,
                COUNT(*) FILTER (WHERE stage NOT IN ('approved','rejected'))::int AS pending
         FROM approval_requests WHERE requested_by = $1`,
        [id]
      ),
    ]);

    const a = activity.rows[0];
    res.json({
      ...userResult.rows[0],
      activity: {
        downloads: a.downloads,
        spent: Number(a.spent),
        firstDownload: a.firstDownload,
        lastDownload: a.lastDownload,
      },
      requests: requests.rows[0],
    });
  } catch (err) {
    console.error('Account lookup failed:', err.message);
    res.status(500).send("Server Error");
  }
});

// ============================================================================
// 12b. DOWNLOAD & REVENUE REPORT
//
// "Between these two dates: who downloaded what, from which part of the
// library, and how much did we take?"
//
// Reads download_events, whose descriptive columns were snapshotted at
// download time — so a report about a past period keeps saying what it said
// then, even if the library has been reorganised since.
// ============================================================================
app.get('/api/reports/downloads', async (req, res) => {
  const { from, to, category } = req.query;

  // `to` is inclusive of the whole day: a report "up to the 5th" must include
  // a download at 16:40 on the 5th, so the upper bound is the 6th at 00:00.
  const fromDate = from ? new Date(`${from}T00:00:00`) : new Date(Date.now() - 30 * 864e5);
  const toDate = to ? new Date(`${to}T00:00:00`) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return res.status(400).json({ message: "from and to must be dates, as YYYY-MM-DD" });
  }
  const toExclusive = new Date(toDate.getTime() + 864e5);

  try {
    const where = ['de.created_at >= $1', 'de.created_at < $2'];
    const values = [fromDate, toExclusive];
    if (category) { values.push(category); where.push(`de.category = $${values.length}`); }
    const clause = `WHERE ${where.join(' AND ')}`;

    const [rows, totals, byCategory, byDay] = await Promise.all([
      pool.query(
        `SELECT de.id,
                de.user_id                                AS "userId",
                de.created_at                             AS "downloadedAt",
                COALESCE(de.user_full_name, de.user_username, 'Unknown') AS "fullName",
                de.user_username                          AS "username",
                de.book_title                             AS "title",
                de.category,
                de.detail,
                de.channel,
                de.page_count                             AS "pageCount",
                de.fee_per_page                           AS "feePerPage",
                de.method,
                de.amount
         FROM download_events de
         ${clause}
         ORDER BY de.created_at DESC
         LIMIT 1000`,
        values
      ),
      pool.query(
        `SELECT COUNT(*)::int                                        AS downloads,
                COALESCE(SUM(de.amount), 0)                          AS revenue,
                COUNT(*) FILTER (WHERE de.channel = 'paid')::int     AS "paidDownloads",
                COUNT(*) FILTER (WHERE de.channel <> 'paid')::int    AS "freeDownloads",
                COUNT(DISTINCT de.user_id)::int                      AS "uniqueUsers"
         FROM download_events de ${clause}`,
        values
      ),
      pool.query(
        `SELECT COALESCE(de.category, 'uncategorised')   AS category,
                COUNT(*)::int                            AS downloads,
                COALESCE(SUM(de.amount), 0)              AS revenue
         FROM download_events de ${clause}
         GROUP BY COALESCE(de.category, 'uncategorised')
         ORDER BY downloads DESC`,
        values
      ),
      pool.query(
        `SELECT TO_CHAR(DATE_TRUNC('day', de.created_at), 'YYYY-MM-DD') AS day,
                COUNT(*)::int                                           AS downloads,
                COALESCE(SUM(de.amount), 0)                             AS revenue
         FROM download_events de ${clause}
         GROUP BY DATE_TRUNC('day', de.created_at)
         ORDER BY DATE_TRUNC('day', de.created_at)`,
        values
      ),
    ]);

    // Category keys are stored on each document; turn them into the labels the
    // admin currently uses so the report reads in their words.
    const labels = {};
    try {
      const cats = await pool.query("SELECT item_key, label FROM taxonomy WHERE kind = 'category'");
      cats.rows.forEach(c => { labels[c.item_key] = c.label; });
    } catch { /* labels are a nicety; the report still works without them */ }

    const t = totals.rows[0];
    res.json({
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
      totals: {
        downloads: t.downloads,
        revenue: Number(t.revenue),
        paidDownloads: t.paidDownloads,
        freeDownloads: t.freeDownloads,
        uniqueUsers: t.uniqueUsers,
      },
      byCategory: byCategory.rows.map(r => ({
        category: r.category,
        label: labels[r.category] || r.category,
        downloads: r.downloads,
        revenue: Number(r.revenue),
      })),
      byDay: byDay.rows.map(r => ({ day: r.day, downloads: r.downloads, revenue: Number(r.revenue) })),
      rows: rows.rows.map(r => ({
        ...r,
        categoryLabel: labels[r.category] || r.category || '—',
        amount: Number(r.amount),
      })),
      truncated: rows.rows.length === 1000,
    });
  } catch (err) {
    console.error('Download report failed:', err.message);
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

// Self-healing admin account: if no account in the database has an admin/
// manager role, create (or repair) the built-in 'admin' account so the
// admin console is always reachable.
//   username: admin      password: ADMIN_BOOTSTRAP_PASSWORD (env), else Admin@1234
// Change that password after first login.
async function ensureAdminAccount() {
  try {
    const existing = await pool.query(
      "SELECT id, username FROM users WHERE LOWER(TRIM(role)) IN ('admin', 'administrator', 'manager') LIMIT 1"
    );
    if (existing.rows.length > 0) {
      console.log(`Admin console account present: ${existing.rows[0].username}`);
      return;
    }

    // The bootstrap password comes from the environment on a public server.
    // The old hardcoded 'Admin@1234' is published in this repository, so on a
    // real domain it is not a password at all — it is an open front door.
    const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'Admin@1234';
    if (!process.env.ADMIN_BOOTSTRAP_PASSWORD) {
      console.warn(
        'WARNING: ADMIN_BOOTSTRAP_PASSWORD is not set, so the admin account ' +
        'is being created with the default password from the source code. ' +
        'Set that variable before this server is reachable from the internet.'
      );
    }
    const passwordHash = await bcrypt.hash(bootstrapPassword, BCRYPT_SALT_ROUNDS);
    const named = await pool.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (named.rows.length > 0) {
      // An 'admin' username exists but with the wrong role — repair it.
      await pool.query(
        "UPDATE users SET role = 'admin', password_hash = $1, status = 'Active' WHERE username = 'admin'",
        [passwordHash]
      );
      console.log("Repaired 'admin' account: role set to admin, password reset to the bootstrap password");
    } else {
      await pool.query(
        `INSERT INTO users (full_name, username, password_hash, role)
         VALUES ('System Administrator', 'admin', $1, 'admin')`,
        [passwordHash]
      );
      console.log('Created admin account — username: admin, password: the bootstrap password');
    }
  } catch (err) {
    console.error('ensureAdminAccount failed:', err.message);
  }
}

// Lightweight self-migration: columns added after the original schema.
async function ensureSchemaUpgrades() {
  // Each upgrade runs on its own. They used to share one try/catch, so the
  // first statement that threw skipped every upgrade after it — one table in
  // an unexpected shape could silently stop a dozen unrelated columns from
  // ever being added, and the only sign was a single line in the log.
  const step = async (what, sql) => {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error(`Schema upgrade "${what}" failed (the rest still run):`, err.message);
    }
  };

  await step('approval_requests.assigned_reviewer_id',
    'ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS assigned_reviewer_id INTEGER');
  await step('books.subject',      'ALTER TABLE books ADD COLUMN IF NOT EXISTS subject TEXT');
  await step('books.call_number',  'ALTER TABLE books ADD COLUMN IF NOT EXISTS call_number VARCHAR(60)');
  await step('books.pub_type',     'ALTER TABLE books ADD COLUMN IF NOT EXISTS pub_type VARCHAR(60)');
  // Holds the chosen sub-item for categories the admin creates themselves.
  // The original four keep using their own columns (report_topic, map_type,
  // map_format, scale, pub_type) so nothing existing has to be rewritten.
  await step('books.classification',
    'ALTER TABLE books ADD COLUMN IF NOT EXISTS classification VARCHAR(120)');

  // The payments table was never created anywhere in this file — only
  // altered — so a database that did not already have one failed on the first
  // payment with a 500 and the useless message "Payment failed".
  await step('payments table', `
    CREATE TABLE IF NOT EXISTS payments (
      id            SERIAL PRIMARY KEY,
      request_id    INTEGER,
      book_id       INTEGER,
      user_id       INTEGER,
      page_count    INTEGER,
      fee_per_page  NUMERIC,
      total_amount  NUMERIC,
      gateway       TEXT,
      status        TEXT,
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  await step('payments columns', `
    ALTER TABLE payments
      ADD COLUMN IF NOT EXISTS request_id    INTEGER,
      ADD COLUMN IF NOT EXISTS book_id       INTEGER,
      ADD COLUMN IF NOT EXISTS user_id       INTEGER,
      ADD COLUMN IF NOT EXISTS page_count    INTEGER,
      ADD COLUMN IF NOT EXISTS fee_per_page  NUMERIC,
      ADD COLUMN IF NOT EXISTS total_amount  NUMERIC,
      ADD COLUMN IF NOT EXISTS gateway       TEXT,
      ADD COLUMN IF NOT EXISTS status        TEXT,
      ADD COLUMN IF NOT EXISTS created_at    TIMESTAMP DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS reference     VARCHAR(80),
      ADD COLUMN IF NOT EXISTS payer_account VARCHAR(40)
  `);

  // Any leftover required column on payments, then cache the real column list
  // so the checkout writes to the names this table actually uses.
  await relaxLeftoverNotNulls('payments', [
    'id', 'request_id', 'book_id', 'user_id', 'page_count', 'fee_per_page',
    'total_amount', 'gateway', 'status', 'created_at', 'reference', 'payer_account',
    'pages', 'price_per_page', 'amount', 'method',
  ]);
  await readPaymentColumns();

  // The name in its own parts, matching what the sign-up form asks for.
  // full_name stays as the composed version — the report, the lists and the
  // CSV all read it.
  await step('users name columns', `
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS first_name  VARCHAR(80),
      ADD COLUMN IF NOT EXISTS middle_name VARCHAR(80),
      ADD COLUMN IF NOT EXISTS last_name   VARCHAR(80)
  `);

  // Split whatever full_name already holds into those parts, once. First word
  // is the first name, last word the last name, anything between the middle.
  // It cannot be perfect — a two-word surname lands in the middle — but it
  // beats leaving every existing account blank, and an administrator can
  // correct any of it from the account panel.
  try {
    const split = await pool.query(`
      UPDATE users
         SET first_name  = split_part(trim(full_name), ' ', 1),
             last_name   = CASE WHEN array_length(string_to_array(trim(full_name), ' '), 1) > 1
                                THEN split_part(trim(full_name), ' ',
                                     array_length(string_to_array(trim(full_name), ' '), 1))
                           END,
             middle_name = CASE WHEN array_length(string_to_array(trim(full_name), ' '), 1) > 2
                                THEN array_to_string(
                                       (string_to_array(trim(full_name), ' '))[2:
                                         array_length(string_to_array(trim(full_name), ' '), 1) - 1], ' ')
                           END
       WHERE first_name IS NULL
         AND COALESCE(TRIM(full_name), '') <> ''
      RETURNING id
    `);
    if (split.rowCount > 0) {
      console.log(`users: split full_name into first/middle/last for ${split.rowCount} account(s)`);
    }
  } catch (err) {
    console.error('Schema upgrade "split full_name" failed (the rest still run):', err.message);
  }
}

// ----------------------------------------------------------------------------
// LIBRARY STRUCTURE (taxonomy)
//
// One self-referencing table holds both levels the admin manages: the cards on
// the library home page (parent_id IS NULL) and the lists inside them.
//
// Maps are the awkward case — format, type and scale are three parallel lists,
// not a chain. Modelling them as a strict tree would force the admin to add
// "Geological Maps" separately under PDF, JPG and Shapefile. So all three hang
// off the Maps category and `kind` says which list each row belongs to, which
// is exactly how the browser already navigates them.
//
// There is no delete, by design. Rows are retired with is_active = false:
// they vanish from the library but documents already filed under them keep
// their label and stay downloadable.
// ----------------------------------------------------------------------------
async function ensureTaxonomy() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS taxonomy (
        id           SERIAL PRIMARY KEY,
        parent_id    INTEGER REFERENCES taxonomy(id),
        kind         VARCHAR(40)  NOT NULL,
        item_key     VARCHAR(120) NOT NULL,
        label        VARCHAR(200) NOT NULL,
        code         VARCHAR(20),
        subtitle     VARCHAR(200),
        icon         VARCHAR(16),
        nav          VARCHAR(20) DEFAULT 'item',
        fee_per_page NUMERIC(10,2),
        sort_order   INTEGER DEFAULT 0,
        is_active    BOOLEAN DEFAULT TRUE,
        created_at   TIMESTAMP DEFAULT NOW(),
        updated_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    // A key is unique within its own list, not globally: '001' can exist under
    // two different categories. COALESCE because parent_id is NULL for
    // categories and NULL never equals NULL in a unique index.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_unique_key
      ON taxonomy (kind, item_key, COALESCE(parent_id, 0))
    `);

    const existing = await pool.query('SELECT COUNT(*)::int AS n FROM taxonomy');
    if (existing.rows[0].n === 0) {
      await seedTaxonomy();
    }
  } catch (err) {
    console.error('Taxonomy setup failed:', err.message);
  }
}

// Fills an empty taxonomy table from taxonomy-seed.js so the library looks
// exactly as it did when everything was hardcoded. Runs once, ever — after
// this the admin owns the structure.
async function seedTaxonomy() {
  const seed = require('./taxonomy-seed');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const idFor = {};

    for (let i = 0; i < seed.CATEGORIES.length; i++) {
      const c = seed.CATEGORIES[i];
      const r = await client.query(
        `INSERT INTO taxonomy (parent_id, kind, item_key, label, subtitle, icon, nav, fee_per_page, sort_order)
         VALUES (NULL, 'category', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [c.item_key, c.label, c.subtitle, c.icon, c.nav, c.fee_per_page, i]
      );
      idFor[c.item_key] = r.rows[0].id;
    }

    const children = [
      ['report_topic', 'technical_report', seed.REPORT_TOPICS],
      ['map_format',   'map',              seed.MAP_FORMATS],
      ['map_type',     'map',              seed.MAP_TYPES],
      ['map_scale',    'map',              seed.MAP_SCALES],
      ['pub_type',     'other_publication',seed.PUB_TYPES],
    ];

    for (const [kind, parentKey, rows] of children) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Report topics are keyed by their zero-padded code; everything else
        // carries its own slug.
        const key = row.item_key || row.code;
        await client.query(
          `INSERT INTO taxonomy (parent_id, kind, item_key, label, code, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [idFor[parentKey], kind, key, row.label, row.code || null, i]
        );
      }
    }

    // Everything already in the library becomes Public. The admin can raise
    // any individual document afterwards from the library view.
    await client.query("UPDATE books SET security_class = 'normal' WHERE security_class IS DISTINCT FROM 'normal'");

    await client.query('COMMIT');
    console.log('Library structure seeded from taxonomy-seed.js; existing documents set to Public');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Taxonomy seed failed:', err.message);
  } finally {
    client.release();
  }
}

// ============================================================================
// SERVE THE BUILT FRONTEND
// On Bluehost one Node process serves both the API and the React build, from
// one domain. That removes CORS entirely and means there is no second host to
// pay for or keep in sync.
//
// Looked for in two places, first hit wins:
//   1. FRONTEND_DIST, if set.
//   2. back-end/public   — copy the build here when uploading through cPanel's
//                          File Manager; it keeps everything under one folder.
//   3. ../front-end/dist — where `npm run build` puts it in the repo.
//
// If none exists the app still runs as an API-only server, exactly as before,
// so local development is unaffected.
// ============================================================================
const frontendCandidates = [
  process.env.FRONTEND_DIST,
  path.join(__dirname, 'public'),
  path.join(__dirname, '..', 'front-end', 'dist'),
].filter(Boolean);

const frontendDist = frontendCandidates.find(
  dir => fs.existsSync(path.join(dir, 'index.html'))
);

if (frontendDist) {
  console.log(`Serving frontend from: ${frontendDist}`);
  app.use(express.static(frontendDist));

  // SPA fallback. Anything that is not an API call and not a real file is
  // handed index.html so the React app can route it. /api and /uploades are
  // excluded so a mistyped endpoint still returns a clean 404 instead of a
  // page of HTML, which is far more confusing to debug.
  app.get(/^\/(?!api\/|uploades\/).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  console.log('No frontend build found — running as an API-only server.');
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server application successfully running on port ${PORT}`);
  // Awaited in order: the taxonomy seed sets books.security_class, so it must
  // run after the column migrations, not alongside them.
  await ensureSchemaUpgrades();
  await ensureTaxonomy();
  await ensureRolesAndWorkflow();
  await ensureDelegations();
  await ensureDownloadLedger();
  // After the roles exist, so the matrix it rewrites is the settled one.
  await ensureAddPermission();
  await ensureAdminAccount();
});