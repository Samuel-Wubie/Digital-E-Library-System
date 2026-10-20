// ----------------------------------------------------------------------------
// File storage — disk, or Supabase Storage.
//
// The mode is chosen by whether SUPABASE_URL is set:
//   - unset → disk mode (the uploades/ folder). This is what Bluehost and your
//             PC both run. Bluehost gives you a normal persistent filesystem,
//             so files written here survive restarts and the app simply keeps
//             its documents next to itself. No object store needed.
//   - set   → remote mode (Supabase Storage). Needed only on hosts that wipe
//             the filesystem on restart, which Render's free tier does.
//
// books.file_path stores the same thing in both modes (a filename / object
// key), so switching between them needs no database migration.
//
// SEPARATE SWITCH — SERVE_UPLOADS_STATIC. Disk mode used to imply an open
// /uploades static route, which made every stored PDF fetchable by anyone who
// knew its filename. That was tolerable on a laptop and is not tolerable on a
// public domain, so the two are now unlinked: disk mode is about where bytes
// live, this is about whether they are served unguarded. It defaults to off.
// ----------------------------------------------------------------------------
const path = require('path');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'documents';

// How long a signed download/preview link stays valid. Short on purpose:
// this is what replaces the old wide-open /uploades route, where any PDF
// could be fetched by anyone who knew the filename.
const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes

const remote = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

let supabase = null;
if (remote) {
  // Service-role key — server-side only, never sent to the browser. It
  // bypasses RLS, which is what lets the backend read every object.
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  console.log(`File storage: Supabase bucket "${BUCKET}"`);
} else {
  console.log('File storage: local disk (set SUPABASE_URL to use Supabase Storage)');
}

// Local-mode upload directory. Unused in remote mode.
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploades');
if (!remote && !fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function isRemote() {
  return remote;
}

// Whether server.js should mount /uploades as an open static directory.
// Local development only — see the note at the top of this file.
function allowStaticUploads() {
  return !remote && process.env.SERVE_UPLOADS_STATIC === 'true';
}

// Same naming rule as the old multer diskStorage: timestamp prefix, spaces
// replaced with dashes. basename() strips any directory part a crafted
// upload might carry, so a filename can never escape the bucket/folder.
function makeObjectKey(originalName) {
  const cleaned = path.basename(String(originalName || 'file'))
    .replace(/\s+/g, '-')
    .replace(/[^\w.\-]/g, '');
  return `${Date.now()}-${cleaned || 'file'}`;
}

// Persists an uploaded file. `file` is a multer file object: in remote mode
// it carries a memory buffer, in local mode it is already on disk.
// Returns the key to store in books.file_path.
async function saveUpload(file) {
  if (!file) return null;

  if (!remote) {
    // multer.diskStorage already wrote it; the filename is the key.
    return file.filename;
  }

  const key = makeObjectKey(file.originalname);
  const { error } = await supabase.storage.from(BUCKET).upload(key, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`Upload to Supabase Storage failed: ${error.message}`);
  return key;
}

// A short-lived URL the browser can open directly, for preview or download.
// Returns null in local mode — callers fall back to streaming from disk.
async function getSignedUrl(key, { download = false } = {}) {
  if (!key || !remote) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL_SECONDS, download ? { download: true } : undefined);
  if (error) throw new Error(`Could not sign URL for "${key}": ${error.message}`);
  return data.signedUrl;
}

// Does the object actually exist? Used so a missing file still produces a
// clean 404 instead of a broken link.
async function exists(key) {
  if (!key) return false;
  if (!remote) return fs.existsSync(path.join(uploadDir, key));
  const { data, error } = await supabase.storage.from(BUCKET).list('', { search: key });
  if (error) return false;
  return (data || []).some(o => o.name === key);
}

function localPath(key) {
  return path.join(uploadDir, key);
}

module.exports = {
  isRemote,
  allowStaticUploads,
  saveUpload,
  getSignedUrl,
  exists,
  localPath,
  uploadDir,
  BUCKET,
};
