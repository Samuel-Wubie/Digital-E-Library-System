const pool = require('../pool');

// ----------------------------------------------------------------------------
// Usage:
//   node seed-report-topics.js [uploaderUserId]
//
// Creates ONE placeholder books row per technical report topic (all 70
// known codes, 001 through 920) — no file attached yet (file_path = NULL).
// You can then go into the app, navigate to that topic, click Edit, and
// upload the actual PDF to replace the placeholder — same approval flow
// as any other edit.
//
// Safe to re-run: skips any topic that already has at least one row under
// category='technical_report' with that exact report_topic, so it won't
// create duplicates alongside rows you've already attached real PDFs to.
// ----------------------------------------------------------------------------

const UPLOADER_ID_ARG = process.argv[2] ? parseInt(process.argv[2], 10) : null;

// Same canonical list as Dashboard.js's TECHNICAL_REPORT_TOPICS.
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

// Must match padCode() in Dashboard.js exactly — 3-digit zero-padded codes.
function padCode(n) {
  return String(n).padStart(3, '0');
}

// Realistic (author, department, location, year) combinations, cycled
// across all 70 topics so the 5-way search filters (author/department/
// location/year range) have varied, testable data instead of one flat
// placeholder repeated 70 times. Title still comes from the topic name
// itself (t.label) so it stays meaningful once a real PDF is attached —
// only these four fields rotate.
const METADATA_VARIETY = [
  { author: 'Abebe Kebede',        department: 'Geology',       location: 'Hawassa',     year: 1998 },
  { author: 'Addis Alemayehu',     department: 'Geoscience',    location: 'Addis Ababa', year: 2002 },
  { author: 'Alem Kebede',         department: 'Geology',       location: 'Gondar',      year: 1985 },
  { author: 'Alemayehu Gelagay',   department: 'Geology',       location: 'Addis Ababa', year: 2001 },
  { author: 'Bealu Girma',         department: 'Hydrogeology',  location: 'Gondar',      year: 2001 },
  { author: 'Bitanita Amanuel',    department: 'Hydrogeology',  location: 'Adama',       year: 2003 },
  { author: 'Efrata Melku',        department: 'Hydrogeology',  location: 'Hawassa',     year: 2002 },
  { author: 'Eyob Lemma',          department: 'Drilling',      location: 'Mekele',      year: 2007 },
  { author: 'Fekade Ephrem',       department: 'Geophysics',    location: 'Adama',       year: 2005 },
  { author: 'Gebremichael Keffale',department: 'Geology',       location: 'Mekele',      year: 2010 },
  { author: 'Kebede Asfawu',       department: 'Geohazard',     location: 'Addis Ababa', year: 2005 },
  { author: 'Lakech Admasu',       department: 'Geophysics',    location: 'Adama',       year: 2001 },
  { author: 'Lemlem Chala',        department: 'Geohazard',     location: 'Gondar',      year: 2008 },
  { author: 'Mekdes Mulaw',        department: 'Geoscience',    location: 'Hawassa',     year: 2000 },
  { author: 'Mulu Mesfin',         department: 'Geoscience',    location: 'Addis Ababa', year: 2000 },
  { author: 'Oliyad Abebe',        department: 'Geohazard',     location: 'Addis Ababa', year: 2025 },
  { author: 'Samuel Wubie',        department: 'Hydrogeology',  location: 'Adama',       year: 2000 },
  { author: 'Selam Alemu',         department: 'Geohazard',     location: 'Hawassa',     year: 2003 },
  { author: 'Sisay Chernet',       department: 'Geoscience',    location: 'Adama',       year: 1999 },
  { author: 'Soliyan Demoz',       department: 'Geophysics',    location: 'Addis Ababa', year: 2001 },
];

async function resolveUploaderId() {
  if (UPLOADER_ID_ARG) return UPLOADER_ID_ARG;
  const res = await pool.query("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  if (res.rows.length === 0) {
    throw new Error('No admin user found — pass an uploaderUserId as an argument.');
  }
  console.log(`No uploaderUserId given — using admin account "${res.rows[0].username}" (id ${res.rows[0].id}).`);
  return res.rows[0].id;
}

async function seedTopics() {
  const uploaderId = await resolveUploaderId();
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < TECHNICAL_REPORT_TOPICS.length; i++) {
    const t = TECHNICAL_REPORT_TOPICS[i];
    const reportTopic = `${padCode(t.number)} ${t.label}`;
    const meta = METADATA_VARIETY[i % METADATA_VARIETY.length];

    const existing = await pool.query(
      `SELECT id FROM books WHERE category = 'technical_report' AND report_topic = $1 LIMIT 1`,
      [reportTopic]
    );
    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    await pool.query(
      `INSERT INTO books (title, author, department, location, published_year, category, report_topic, uploaded_by, page_count, security_class)
       VALUES ($1, $2, $3, $4, $5, 'technical_report', $6, $7, $8, 'normal')`,
      [t.label, meta.author, meta.department, meta.location, meta.year, reportTopic, uploaderId, 12]
    );
    console.log(`  + [${reportTopic}] ${meta.author} · ${meta.department} · ${meta.location} · ${meta.year}`);
    created++;
  }

  console.log(`\nDone. Created ${created} placeholder(s), skipped ${skipped} (already existed).`);
  console.log('Attach real PDFs via Edit on each record in the app whenever you have them.');
  await pool.end();
}

seedTopics().catch(err => {
  console.error('seed-report-topics failed:', err.message);
  process.exit(1);
});