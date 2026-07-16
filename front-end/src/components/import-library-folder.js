const fs = require('fs');
const path = require('path');
const pool = require('../pool');

// ----------------------------------------------------------------------------
// Usage:
//   node import-library-folder.js "C:\Users\HP\Desktop\librery system\db" [uploaderUserId]
//
// Expects the "db" folder to contain:
//   reports/<numbered topic folder>/*.pdf
//   maps/<type folder>/[<scale folder>/]*.{pdf,jpg,jpeg,shp,zip}
//   other-publications/*.*
//
// Copies every matched file into back-end/uploades and inserts a books row
// with the right category/report_topic/map_type/map_format/scale already
// set — no approval chain, since this is a one-time data migration, not a
// live user submission.
// ----------------------------------------------------------------------------

const BASE_DIR = process.argv[2];
const UPLOADER_ID_ARG = process.argv[3] ? parseInt(process.argv[3], 10) : null;
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploades');

// Same canonical topic list as Dashboard.js's TECHNICAL_REPORT_TOPICS.
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

const scaleValuesSeen = new Set();

function extractLeadingNumber(folderName) {
  const match = folderName.match(/^\s*0*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function guessTitleFromFilename(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim() || filename;
}

function detectMapType(folderName) {
  const n = folderName.toLowerCase();
  if (n.includes('engineering')) return 'engineering_geological';
  if (n.includes('hydrochemical')) return 'hydrochemical';
  if (n.includes('hydrogeological')) return 'hydrogeological';
  if (n.includes('topo')) return 'topo';
  if (n.includes('geological')) return 'geological';
  return null;
}

function detectMapFormat(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') return 'jpg';
  if (ext === '.shp' || ext === '.zip') return 'shapefile';
  return null;
}

function normalizeScale(folderName) {
  const cleaned = folderName.trim().replace(/^1[-:]\s*/, '1:');
  scaleValuesSeen.add(cleaned);
  return cleaned;
}

function isDocFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.pdf', '.jpg', '.jpeg', '.png', '.shp', '.zip'].includes(ext);
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

function copyIntoUploads(sourcePath, originalFilename) {
  const cleanedName = originalFilename.replace(/\s+/g, '-');
  const destFilename = `${Date.now()}-${Math.floor(Math.random() * 100000)}-${cleanedName}`;
  fs.copyFileSync(sourcePath, path.join(UPLOAD_DIR, destFilename));
  return destFilename;
}

async function insertBook({ title, filePath, category, reportTopic, mapType, mapFormat, scale, uploaderId }) {
  await pool.query(
    `INSERT INTO books (title, file_path, category, report_topic, map_type, map_format, scale, uploaded_by, page_count, security_class)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'normal')`,
    [title, filePath, category, reportTopic || null, mapType || null, mapFormat || null, scale || null, uploaderId, 12]
  );
}

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------
async function importReports(reportsDir, uploaderId) {
  if (!fs.existsSync(reportsDir)) {
    console.log('No reports/ folder found — skipping.');
    return { imported: 0 };
  }
  let imported = 0;
  const unmatched = [];
  const folders = fs.readdirSync(reportsDir).filter(f => fs.statSync(path.join(reportsDir, f)).isDirectory());

  for (const folderName of folders) {
    const number = extractLeadingNumber(folderName);
    const label = number !== null ? TOPIC_BY_NUMBER.get(number) : null;
    if (!label) { unmatched.push(folderName); continue; }

    const reportTopic = `${padCode(number)} ${label}`;
    const folderPath = path.join(reportsDir, folderName);
    const files = fs.readdirSync(folderPath).filter(isDocFile);

    for (const file of files) {
      const destFilename = copyIntoUploads(path.join(folderPath, file), file);
      await insertBook({
        title: guessTitleFromFilename(file), filePath: destFilename,
        category: 'technical_report', reportTopic, uploaderId,
      });
      console.log(`  [report] [${reportTopic}] ${file}`);
      imported++;
    }
  }

  if (unmatched.length > 0) {
    console.log(`\n${unmatched.length} report folder(s) had no matching topic number and were skipped:`);
    unmatched.forEach(f => console.log(`  - ${f}`));
  }
  return { imported };
}

// ---------------------------------------------------------------------------
// MAPS
// ---------------------------------------------------------------------------
async function importMaps(mapsDir, uploaderId) {
  if (!fs.existsSync(mapsDir)) {
    console.log('No maps/ folder found — skipping.');
    return { imported: 0 };
  }
  let imported = 0;
  const unmatchedTypeFolders = [];
  const unmatchedFormatFiles = [];
  const typeFolders = fs.readdirSync(mapsDir).filter(f => fs.statSync(path.join(mapsDir, f)).isDirectory());

  for (const typeFolderName of typeFolders) {
    const mapType = detectMapType(typeFolderName);
    if (!mapType) { unmatchedTypeFolders.push(typeFolderName); continue; }

    const typeFolderPath = path.join(mapsDir, typeFolderName);
    const entries = fs.readdirSync(typeFolderPath);
    const subfolders = entries.filter(e => fs.statSync(path.join(typeFolderPath, e)).isDirectory());
    const directFiles = entries.filter(e => isDocFile(e));

    // Files directly inside the type folder (no scale subfolder) — fine for
    // hydrochemical/hydrogeological/topo; for geological/engineering, this
    // means no scale was recorded for these specific files.
    for (const file of directFiles) {
      const format = detectMapFormat(file);
      if (!format) { unmatchedFormatFiles.push(`${typeFolderName}/${file}`); continue; }
      const destFilename = copyIntoUploads(path.join(typeFolderPath, file), file);
      await insertBook({
        title: guessTitleFromFilename(file), filePath: destFilename,
        category: 'map', mapType, mapFormat: format, scale: null, uploaderId,
      });
      console.log(`  [map] [${mapType}] ${file}`);
      imported++;
    }

    // Scale subfolders (geological / engineering_geological).
    for (const scaleFolderName of subfolders) {
      const scale = normalizeScale(scaleFolderName);
      const scaleFolderPath = path.join(typeFolderPath, scaleFolderName);
      const scaleFiles = fs.readdirSync(scaleFolderPath).filter(isDocFile);
      for (const file of scaleFiles) {
        const format = detectMapFormat(file);
        if (!format) { unmatchedFormatFiles.push(`${typeFolderName}/${scaleFolderName}/${file}`); continue; }
        const destFilename = copyIntoUploads(path.join(scaleFolderPath, file), file);
        await insertBook({
          title: guessTitleFromFilename(file), filePath: destFilename,
          category: 'map', mapType, mapFormat: format, scale, uploaderId,
        });
        console.log(`  [map] [${mapType} / ${scale}] ${file}`);
        imported++;
      }
    }
  }

  if (unmatchedTypeFolders.length > 0) {
    console.log(`\n${unmatchedTypeFolders.length} map folder(s) didn't match a known map type and were skipped:`);
    unmatchedTypeFolders.forEach(f => console.log(`  - ${f}`));
  }
  if (unmatchedFormatFiles.length > 0) {
    console.log(`\n${unmatchedFormatFiles.length} file(s) had an unrecognized extension and were skipped:`);
    unmatchedFormatFiles.forEach(f => console.log(`  - ${f}`));
  }
  return { imported };
}

// ---------------------------------------------------------------------------
// OTHER PUBLICATIONS
// ---------------------------------------------------------------------------
async function importOtherPublications(dir, uploaderId) {
  if (!fs.existsSync(dir)) {
    console.log('No other-publications/ folder found — skipping.');
    return { imported: 0 };
  }
  let imported = 0;
  const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
  for (const file of files) {
    const destFilename = copyIntoUploads(path.join(dir, file), file);
    await insertBook({
      title: guessTitleFromFilename(file), filePath: destFilename,
      category: 'other_publication', uploaderId,
    });
    console.log(`  [other] ${file}`);
    imported++;
  }
  return { imported };
}

// ---------------------------------------------------------------------------
async function run() {
  if (!BASE_DIR) {
    console.error('Usage: node import-library-folder.js "<path to db folder>" [uploaderUserId]');
    process.exit(1);
  }
  if (!fs.existsSync(BASE_DIR)) {
    console.error(`Folder not found: ${BASE_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const uploaderId = await resolveUploaderId();

  console.log('\n--- Reports ---');
  const reportsResult = await importReports(path.join(BASE_DIR, 'reports'), uploaderId);

  console.log('\n--- Maps ---');
  const mapsResult = await importMaps(path.join(BASE_DIR, 'maps'), uploaderId);

  console.log('\n--- Other Publications ---');
  const otherResult = await importOtherPublications(path.join(BASE_DIR, 'other-publications'), uploaderId);

  const total = reportsResult.imported + mapsResult.imported + otherResult.imported;
  console.log(`\n=== Done. Imported ${total} file(s) total. ===`);
  console.log(`  Reports: ${reportsResult.imported}  Maps: ${mapsResult.imported}  Other: ${otherResult.imported}`);

  if (scaleValuesSeen.size > 0) {
    console.log(`\nDistinct scale values found on disk (check these exactly match SCALES_BY_MAP_TYPE in Dashboard.js):`);
    [...scaleValuesSeen].sort().forEach(s => console.log(`  - "${s}"`));
  }

  await pool.end();
}

run().catch(err => {
  console.error('import-library-folder failed:', err.message);
  process.exit(1);
});