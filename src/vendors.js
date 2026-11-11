// The database is data/vendors.json, compiled to plain JavaScript (see scripts/generate-data.js) so it
// loads without warnings on every Node version and in bundlers such as Turbopack and webpack.
import { vendorData } from './generated-data.js';
import { regionOf, countryName, cloudActExposed } from './jurisdiction.js';

let cache;

/** Loads the bundled vendor database once. */
export function loadVendorDb() {
  if (!cache) {
    const raw = vendorData;
    const vendors = raw.vendors.map(enrichVendor);
    cache = { version: raw.version, vendors, byId: new Map(vendors.map((v) => [v.id, v])) };
  }
  return cache;
}

function enrichVendor(v) {
  return {
    ...v,
    region: regionOf(v.hq),
    country: countryName(v.hq),
    cloudAct: cloudActExposed(v.hq),
    recommend: Boolean(v.recommend),
    euRegion: Boolean(v.euRegion),
    subprocessors: v.subprocessors || null,
  };
}

export function getVendor(id) {
  return loadVendorDb().byId.get(id) || null;
}

export function listVendors() {
  return loadVendorDb().vendors;
}

/** EU-based vendors we suggest as a switch target in the same category. */
export function alternativesFor(vendorOrId, limit = 3) {
  const vendor = typeof vendorOrId === 'string' ? getVendor(vendorOrId) : vendorOrId;
  if (!vendor || vendor.region === 'eu' || vendor.region === 'eea') return [];
  return listVendors()
    .filter((v) => v.category === vendor.category && v.recommend && (v.region === 'eu' || v.region === 'eea' || v.region === 'adequate'))
    .slice(0, limit)
    .map((v) => ({ id: v.id, name: v.name, country: v.country, region: v.region }));
}

export const CATEGORY_LABELS = {
  hosting: 'Hosting',
  cdn: 'CDN and edge',
  dns: 'DNS',
  database: 'Database',
  storage: 'File storage',
  email: 'Email and workspace',
  'email-security': 'Email security',
  'transactional-email': 'Transactional email',
  'marketing-email': 'Marketing email',
  crm: 'CRM',
  analytics: 'Analytics',
  advertising: 'Advertising pixels',
  monitoring: 'Error and performance monitoring',
  support: 'Customer support',
  payments: 'Payments',
  auth: 'Login and identity',
  realtime: 'Realtime messaging',
  search: 'Search',
  communications: 'SMS and voice',
  collaboration: 'Collaboration',
  scheduling: 'Scheduling',
  forms: 'Forms',
  media: 'Video embeds',
  fonts: 'Web fonts',
  maps: 'Maps',
  captcha: 'Captcha',
  consent: 'Cookie consent',
  ecommerce: 'Ecommerce platform',
  'dev-tools': 'Developer tools',
  ai: 'AI and machine learning',
};

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || category;
}
