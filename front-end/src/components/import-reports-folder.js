const fs = require('fs');
const path = require('path');
const pool = require('../pool');

// ----------------------------------------------------------------------------
// Usage:
//   node import-reports-folder.js "C:\Users\HP\Desktop\librery system\db\reports" [uploaderUserId]
//
// Expects subfolders like "001 abrasives (Pumice)", "002 Kaolin Belesa...",
// each containing one or more PDF files. The leading number in the folder
// name is matched against the canonical topic list below (same list used
// in Dashboard.js's TECHNICAL_REPORT_TOPICS) — the folder's own wording is
// NOT used for report_topic, so results always exactly match what the app
// filters on, regardless of typos/punctuation in your local folder names.
//
// Files are copied (not moved) into back-end/uploades with a timestamp
// prefix, matching the naming convention multer already uses, then a
// books row is inserted per file with category='technical_report' and
// the matched report_topic.
// ----------------------------------------------------------------------------

const REPORTS_DIR = process.argv[2];
const UPLOADER_ID_ARG = process.argv[3] ? parseInt(process.argv[3], 10) : null;
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploades');

// Same canonical list as Dashboard.js's TECHNICAL_REPORT_TOPICS — keep in
// sync if a topic is ever renamed there.
const TECHNICAL_REPORT_TOPICS = [
  { number: 1,   label: 'Abrasives (Pumice)' },
  { number: 2,   label: 'Kaolin Belesa Feldspar, Quartz' },
  { number: 5,   label: 'Asbestos' },
  { number: 6,   label: 'Baryte' },
  { number: 7,   label: 'Beryl' },
  { number: 8,   label: 'Black Sands' },
  { number: 11,  label: 'Building Material (Pumice)' },
  { number: 14,  label: 'Calcium' },
  { number: 15,  label: 'Carbon Dioxide' },
  { number: 16,  label: 'Cement Raw Material' },
  { number: 18,  label: 'Ceramics' },
  { number: 19,  label: 'Chromite' },
  { number: 20,  label: 'Bentonite & Clay (Kyanite)' },
  { number: 21,  label: 'Coal, Lignite' },
  { number: 24,  label: 'Copper' },
  { number: 27,  label: 'Diatomite' },
  { number: 29,  label: 'Evaporite Minerals' },
  { number: 30,  label: 'Calcitic, Industrial Deposit' },
  { number: 38,  label: 'Gemstones' },
  { number: 40,  label: 'Sheet Glass' },
  { number: 41,  label: 'Gold' },
  { number: 42,  label: 'Graphite and Talc' },
  { number: 43,  label: 'Gypsum, Alluvial' },
  { number: 47,  label: 'Sysertskite' },
  { number: 48,  label: 'Iron Report' },
  { number: 49,  label: 'Lead, Zinc' },
  { number: 50,  label: 'Building Stone, Lime & Limestone Marble' },
  { number: 54,  label: 'Manganese' },
  { number: 57,  label: 'Mica' },
  { number: 58,  label: 'Mineral Water' },
  { number: 63,  label: 'Nickel' },
  { number: 65,  label: 'Olivine' },
  { number: 68,  label: 'Petroleum Oil & Gas' },
  { number: 69,  label: 'Ilmenite, Apatite, Phosphate & Magnetite' },
  { number: 70,  label: 'Pigments' },
  { number: 71,  label: 'Platinum' },
  { number: 73,  label: 'Potash' },
  { number: 76,  label: 'Quartzite' },
  { number: 83,  label: 'Salt' },
  { number: 90,  label: 'Silica, Silicon Dolomite' },
  { number: 92,  label: 'Sodium, Soda' },
  { number: 94,  label: 'Sulphur' },
  { number: 97,  label: 'Tantalum' },
  { number: 102, label: 'Tin' },
  { number: 103, label: 'Titanium' },
  { number: 104, label: 'Travertine' },
  { number: 105, label: 'Tungsten' },
  { number: 106, label: 'Uranium' },
  { number: 107, label: 'Vanadium' },
  { number: 108, label: 'Water' },
  { number: 111, label: 'Zircon' },
  { number: 780, label: 'Bibliography' },
  { number: 790, label: 'Cartography Maps' },
  { number: 800, label: 'Chemistry' },
  { number: 810, label: 'Geochemistry' },
  { number: 820, label: 'Geochronology' },
  { number: 821, label: 'Geology' },
  { number: 822, label: 'Economic Geology' },
  { number: 823, label: 'Engineering' },
  { number: 824, label: 'Structural Geology' },
  { number: 830, label: 'Geomorphology' },
  { number: 840, label: 'Geophysics' },
  { number: 860, label: 'Geothermal' },
  { number: 875, label: 'Glaciation' },
  { number: 880, label: 'Hydrogeology' },
  { number: 900, label: 'Mineralogy' },
  { number: 905, label: 'Mining & Prospecting' },
  { number: 908, label: 'Palaeogeography' },
  { number: 910, label: 'Palaeontology' },
  { number: 912, label: 'Petrology' },
  { number: 914, label: 'Photogeology' },
  { number: 916, label: 'Stratigraphy' },
  { number: 920, label: 'Volcanology' },
];
const TOPIC_BY_NUMBER = new Map(TECHNICAL_REPORT_TOPICS.map(t => [t.number, t.label]));

// Must match padCode() in Dashboard.js exactly — 3-digit zero-padded codes.
function padCode(n) {
  return String(n).padStart(3, '0');
}

function extractLeadingNumber(folderName) {
  const match = folderName.match(/^\s*0*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function guessTitleFromFilename(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim() || filename;
}

async function resolveUploaderId() {
  if (UPLOADER_ID_ARG) return UPLOADER_ID_ARG;
  const res = await pool.query("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  if (res.rows.length === 0) {
    throw new Error('No admin user found — pass an uploaderUserId as the second argument.');
  }
  console.log(`No uploaderUserId given — using admin account "${res.rows[0].username}" (id ${res.rows[0].id}).`);
  return res.rows[0].id;
}

async function importReports() {
  if (!REPORTS_DIR) {
    console.error('Usage: node import-reports-folder.js "<path to reports folder>" [uploaderUserId]');
    process.exit(1);
  }
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error(`Reports folder not found: ${REPORTS_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const uploaderId = await resolveUploaderId();

  const subfolders = fs.readdirSync(REPORTS_DIR).filter(f =>
    fs.statSync(path.join(REPORTS_DIR, f)).isDirectory()
  );

  let imported = 0;
  let skippedFolders = 0;
  let skippedNoPdf = 0;
  const unmatched = [];

  for (const folderName of subfolders) {
    const number = extractLeadingNumber(folderName);
    const label = number !== null ? TOPIC_BY_NUMBER.get(number) : null;

    if (number === null || !label) {
      unmatched.push(folderName);
      skippedFolders++;
      continue;
    }

    const reportTopic = `${padCode(number)} ${label}`;
    const folderPath = path.join(REPORTS_DIR, folderName);
    const pdfFiles = fs.readdirSync(folderPath).filter(f => f.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      skippedNoPdf++;
      continue;
    }

    for (const pdfFile of pdfFiles) {
      const sourcePath = path.join(folderPath, pdfFile);
      const cleanedName = pdfFile.replace(/\s+/g, '-');
      const destFilename = `${Date.now()}-${Math.floor(Math.random() * 1000)}-${cleanedName}`;
      const destPath = path.join(UPLOAD_DIR, destFilename);

      fs.copyFileSync(sourcePath, destPath);

      await pool.query(
        `INSERT INTO books (title, file_path, category, report_topic, uploaded_by, page_count, security_class)
         VALUES ($1, $2, 'technical_report', $3, $4, $5, 'normal')`,
        [guessTitleFromFilename(pdfFile), destFilename, reportTopic, uploaderId, 12]
      );

      console.log(`  + [${reportTopic}] ${pdfFile}`);
      imported++;
    }
  }

  console.log(`\nDone. Imported ${imported} PDF(s).`);
  if (skippedNoPdf > 0) console.log(`${skippedNoPdf} folder(s) matched a topic but had no PDF files inside.`);
  if (unmatched.length > 0) {
    console.log(`\n${unmatched.length} folder(s) did NOT match a known topic number and were skipped:`);
    unmatched.forEach(f => console.log(`  - ${f}`));
    console.log('Add these to TECHNICAL_REPORT_TOPICS (in both this script and Dashboard.js) if they should be imported.');
  }

  await pool.end();
}

importReports().catch(err => {
  console.error('import-reports-folder failed:', err.message);
  process.exit(1);
});