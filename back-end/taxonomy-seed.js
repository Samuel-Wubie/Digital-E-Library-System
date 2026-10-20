// ----------------------------------------------------------------------------
// DEFAULT LIBRARY STRUCTURE
//
// This is the seed only. Once the taxonomy table has rows, the admin owns it
// and this file is never consulted again — editing it will NOT change a
// running system. Add and rename categories from Admin → Library structure.
//
// Lifted verbatim from the constants that used to live at the top of
// Dashboard.js, so the library looks identical after the migration.
//
// kinds:
//   category     — a card on the library home page (parent_id NULL)
//   report_topic — numbered topics under Technical Reports
//   map_format   — PDF / JPG / Shapefile
//   map_type     — Geological / Hydrogeological / ...
//   map_scale    — 1:25,000 / ...
//   pub_type     — Company Reports / Journals / ...
//   item         — the generic one-level list any NEW category gets
// ----------------------------------------------------------------------------

const CATEGORIES = [
  { item_key: 'technical_report', label: 'Technical Reports',  icon: '\u{1F4D1}', subtitle: 'Browse by report number',                      fee_per_page: 2, nav: 'report_topic' },
  { item_key: 'map',              label: 'Maps',               icon: '\u{1F5FA}', subtitle: 'PDF \u00b7 JPG \u00b7 Shapefile',                        fee_per_page: 5, nav: 'map' },
  { item_key: 'other_publication',label: 'Other Publications', icon: '\u{1F4DA}', subtitle: 'Company \u00b7 Journals \u00b7 Government \u00b7 Others',    fee_per_page: 2, nav: 'pub_type' },
  { item_key: 'book',             label: 'Books',              icon: '\u{1F4D6}', subtitle: 'Search by author, title, subject, call number', fee_per_page: 2, nav: 'none' },
];

const REPORT_TOPICS = [
  { code: '001', label: 'Abrasives (Pumice)' },
  { code: '002', label: 'Kaolin Belesa Feldspar, Quartz' },
  { code: '005', label: 'Asbestos' },
  { code: '006', label: 'Baryte' },
  { code: '007', label: 'Beryl' },
  { code: '008', label: 'Black Sands' },
  { code: '011', label: 'Building Material (Pumice)' },
  { code: '014', label: 'Calcium' },
  { code: '015', label: 'Carbon Dioxide' },
  { code: '016', label: 'Cement Raw Material' },
  { code: '018', label: 'Ceramics' },
  { code: '019', label: 'Chromite' },
  { code: '020', label: 'Bentonite & Clay (Kyanite)' },
  { code: '021', label: 'Coal, Lignite' },
  { code: '024', label: 'Copper' },
  { code: '027', label: 'Diatomite' },
  { code: '029', label: 'Evaporite Minerals' },
  { code: '030', label: 'Calcitic, Industrial Deposit' },
  { code: '038', label: 'Gemstones' },
  { code: '040', label: 'Sheet Glass' },
  { code: '041', label: 'Gold' },
  { code: '042', label: 'Graphite and Talc' },
  { code: '043', label: 'Gypsum, Alluvial' },
  { code: '047', label: 'Sysertskite' },
  { code: '048', label: 'Iron Report' },
  { code: '049', label: 'Lead, Zinc' },
  { code: '050', label: 'Building Stone, Lime & Limestone Marble' },
  { code: '054', label: 'Manganese' },
  { code: '057', label: 'Mica' },
  { code: '058', label: 'Mineral Water' },
  { code: '063', label: 'Nickel' },
  { code: '065', label: 'Olivine' },
  { code: '068', label: 'Petroleum Oil & Gas' },
  { code: '069', label: 'Ilmenite, Apatite, Phosphate & Magnetite' },
  { code: '070', label: 'Pigments' },
  { code: '071', label: 'Platinum' },
  { code: '073', label: 'Potash' },
  { code: '076', label: 'Quartzite' },
  { code: '083', label: 'Salt' },
  { code: '090', label: 'Silica, Silicon Dolomite' },
  { code: '092', label: 'Sodium, Soda' },
  { code: '094', label: 'Sulphur' },
  { code: '097', label: 'Tantalum' },
  { code: '102', label: 'Tin' },
  { code: '103', label: 'Titanium' },
  { code: '104', label: 'Travertine' },
  { code: '105', label: 'Tungsten' },
  { code: '106', label: 'Uranium' },
  { code: '107', label: 'Vanadium' },
  { code: '108', label: 'Water' },
  { code: '111', label: 'Zircon' },
  { code: '780', label: 'Bibliography' },
  { code: '790', label: 'Cartography Maps' },
  { code: '800', label: 'Chemistry' },
  { code: '810', label: 'Geochemistry' },
  { code: '820', label: 'Geochronology' },
  { code: '821', label: 'Geology' },
  { code: '822', label: 'Economic Geology' },
  { code: '823', label: 'Engineering' },
  { code: '824', label: 'Structural Geology' },
  { code: '830', label: 'Geomorphology' },
  { code: '840', label: 'Geophysics' },
  { code: '860', label: 'Geothermal' },
  { code: '875', label: 'Glaciation' },
  { code: '880', label: 'Hydrogeology' },
  { code: '900', label: 'Mineralogy' },
  { code: '905', label: 'Mining & Prospecting' },
  { code: '908', label: 'Palaeogeography' },
  { code: '910', label: 'Palaeontology' },
  { code: '912', label: 'Petrology' },
  { code: '914', label: 'Photogeology' },
  { code: '916', label: 'Stratigraphy' },
  { code: '920', label: 'Volcanology' },
];

const MAP_FORMATS = [
  { item_key: 'pdf', label: 'PDF' },
  { item_key: 'jpg', label: 'JPG' },
  { item_key: 'shapefile', label: 'Shapefile' },
];

const MAP_TYPES = [
  { item_key: 'geological', label: 'Geological Maps' },
  { item_key: 'hydrogeological', label: 'Hydrogeological Maps' },
  { item_key: 'hydrochemical', label: 'Hydrochemical Maps' },
  { item_key: 'engineering_geological', label: 'Engineering Geological Maps' },
  { item_key: 'topo', label: 'Topo Maps' },
];

const MAP_SCALES = [
  { item_key: '1:25,000', label: '1:25,000' },
  { item_key: '1:50,000', label: '1:50,000' },
  { item_key: '1:100,000', label: '1:100,000' },
  { item_key: '1:200,000', label: '1:200,000' },
  { item_key: '1:250,000', label: '1:250,000' },
  { item_key: '1:500,000', label: '1:500,000' },
  { item_key: '1:1,000,000', label: '1:1,000,000' },
  { item_key: '1:2,000,000', label: '1:2,000,000' },
];

const PUB_TYPES = [
  { item_key: 'company_report', label: 'Company Reports' },
  { item_key: 'journal', label: 'Journals' },
  { item_key: 'governmental_publication', label: 'Governmental Publications' },
  { item_key: 'other', label: 'Others' },
];

module.exports = { CATEGORIES, REPORT_TOPICS, MAP_FORMATS, MAP_TYPES, MAP_SCALES, PUB_TYPES };
