const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------------
// Usage:
//   node create-category-folders.js "C:\Users\HP\Desktop\librery system\uploades"
//
// If you don't pass a path, it creates the tree inside the current folder
// you run the command from.
// ----------------------------------------------------------------------------

const BASE_DIR = process.argv[2] || path.join(process.cwd(), 'uploades');

// Same list as TECHNICAL_REPORT_TOPICS in Dashboard.js — keep these two in
// sync if a topic is ever renamed or added.
const TECHNICAL_REPORT_TOPICS_RAW = [
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

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[(),]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function padCode(n) {
  return String(n).padStart(3, '0');
}

const TECHNICAL_REPORT_TOPICS = TECHNICAL_REPORT_TOPICS_RAW
  .sort((a, b) => a.number - b.number)
  .map(t => `${padCode(t.number)}-${slugify(t.label)}`);

const MAP_FORMATS = ['pdf', 'jpg', 'shapefile'];

const MAP_TYPES_WITH_SCALES = {
  'geological': ['1-50000', '1-100000', '1-250000', '1-500000', '1-1000000', '1-2000000'],
  'hydrogeological': null,           // no scale subfolder
  'hydrochemical': null,             // no scale subfolder
  'engineering-geological': ['1-50000', '1-250000'],
  'topo': null,                      // no scale subfolder
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`  + ${dirPath}`);
  }
}

function buildTree() {
  console.log(`Creating category folder tree under:\n  ${BASE_DIR}\n`);

  // Technical Reports
  const techBase = path.join(BASE_DIR, 'technical-reports');
  TECHNICAL_REPORT_TOPICS.forEach(topic => ensureDir(path.join(techBase, topic)));

  // Maps: format -> type -> (scale, if that type has scales)
  const mapsBase = path.join(BASE_DIR, 'maps');
  MAP_FORMATS.forEach(format => {
    Object.entries(MAP_TYPES_WITH_SCALES).forEach(([mapType, scales]) => {
      const typeDir = path.join(mapsBase, format, mapType);
      if (scales) {
        scales.forEach(scale => ensureDir(path.join(typeDir, scale)));
      } else {
        ensureDir(typeDir);
      }
    });
  });

  // Other Publications
  ensureDir(path.join(BASE_DIR, 'other-publications'));

  console.log('\nDone.');
}

buildTree();