// Where a company is based decides which laws can reach the data it holds.
// We group countries into the regions that matter for GDPR transfers.

export const EU_MEMBERS = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

const EEA_ONLY = new Set(['IS', 'LI', 'NO']);

// Countries with an EU adequacy decision (US is handled separately: its decision,
// the Data Privacy Framework, covers only certified companies and the CLOUD Act still applies).
const ADEQUATE = new Set(['GB', 'CH', 'AD', 'AR', 'CA', 'FO', 'GG', 'IL', 'IM', 'JP', 'JE', 'NZ', 'KR', 'UY']);

const COUNTRY_NAMES = {
  AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark',
  EE: 'Estonia', FI: 'Finland', FR: 'France', DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland',
  IT: 'Italy', LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden', IS: 'Iceland',
  LI: 'Liechtenstein', NO: 'Norway', GB: 'United Kingdom', CH: 'Switzerland', CA: 'Canada', IL: 'Israel',
  JP: 'Japan', KR: 'South Korea', NZ: 'New Zealand', US: 'United States', IN: 'India', AU: 'Australia',
  SG: 'Singapore', CN: 'China', BR: 'Brazil',
};

/** @returns {'eu' | 'eea' | 'adequate' | 'us' | 'other' | 'unknown'} */
export function regionOf(countryCode) {
  const cc = String(countryCode || '').toUpperCase();
  if (!cc) return 'unknown';
  if (EU_MEMBERS.has(cc)) return 'eu';
  if (EEA_ONLY.has(cc)) return 'eea';
  if (cc === 'US') return 'us';
  if (ADEQUATE.has(cc)) return 'adequate';
  return 'other';
}

export function countryName(countryCode) {
  const cc = String(countryCode || '').toUpperCase();
  return COUNTRY_NAMES[cc] || cc || 'Unknown';
}

export const REGION_LABELS = {
  eu: 'EU',
  eea: 'EEA',
  adequate: 'Adequate country',
  us: 'United States',
  other: 'Outside EU',
  unknown: 'Unknown',
};

/** US companies can be compelled to hand over data stored anywhere (CLOUD Act, FISA 702). */
export function cloudActExposed(countryCode) {
  return String(countryCode || '').toUpperCase() === 'US';
}
