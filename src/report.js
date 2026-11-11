import { detectVendors, usesEuRegion } from './detect.js';
import { getVendor, alternativesFor, categoryLabel, loadVendorDb } from './vendors.js';
import { computeScore } from './score.js';
import { suggestAiSystems } from './ai-act.js';

export const DISCLAIMER =
  'Automated technical overview based on public signals. It can miss vendors that only run on the server side and it is not legal advice.';

const WEAK_SOURCES = new Set(['DNS TXT', 'CSP header']);

// Riskiest jurisdictions first, so the report reads as a to-do list.
const REGION_ORDER = { us: 0, other: 1, unknown: 2, adequate: 3, eea: 4, eu: 5 };

function byRiskThenName(a, b) {
  return REGION_ORDER[a.region] - REGION_ORDER[b.region] || a.name.localeCompare(b.name);
}

/** Converts detected vendor ids + evidence into rich report rows. */
export function toVendorRows(found, extraText = '') {
  const rows = [];
  for (const [id, evidence] of found) {
    const v = getVendor(id);
    if (!v) continue;
    rows.push({
      id: v.id,
      name: v.name,
      category: v.category,
      categoryLabel: categoryLabel(v.category),
      hq: v.hq,
      country: v.country,
      region: v.region,
      cloudAct: v.cloudAct,
      euRegion: v.euRegion,
      euRegionInUse: usesEuRegion(v, evidence, extraText),
      // A TXT verification token proves an account exists, and a CSP entry can outlive the integration:
      // neither alone shows that data flows there today.
      confidence: evidence.every((e) => WEAK_SOURCES.has(e.source)) ? 'likely' : 'confirmed',
      subprocessors: v.subprocessors,
      ai: v.ai || null,
      evidence,
      alternatives: alternativesFor(v),
    });
  }
  return rows.sort(byRiskThenName);
}

/**
 * @param {object} input
 * @param {string} input.target
 * @param {'domain'|'repo'} input.kind
 * @param {object[]} input.vendors rows from toVendorRows or mergeVendorRows
 * @param {string[]} [input.notes]
 * @param {object} [input.meta]
 * @param {object} [input.coverage] which sources were checked, so readers can judge completeness
 * @param {object[]} [input.unrecognized] third-party domains that match no known vendor
 */
export function buildReport({ target, kind, vendors, notes = [], meta = {}, coverage = {}, unrecognized = [] }) {
  return {
    target,
    kind,
    scannedAt: new Date().toISOString(),
    databaseVersion: loadVendorDb().version,
    score: computeScore(vendors),
    vendors,
    aiSystems: suggestAiSystems(vendors),
    unrecognized,
    coverage,
    notes,
    meta,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Merges vendor rows from several reports (for example a domain scan and a repo scan).
 * Evidence is combined, and the strongest finding wins: one confirmed signal
 * outweighs any number of "likely" ones.
 */
export function mergeVendorRows(...lists) {
  const byId = new Map();
  for (const row of lists.flat()) {
    const prev = byId.get(row.id);
    if (!prev) {
      byId.set(row.id, { ...row, evidence: [...row.evidence] });
      continue;
    }
    for (const e of row.evidence) {
      if (!prev.evidence.some((p) => p.source === e.source && p.value === e.value)) prev.evidence.push(e);
    }
    prev.euRegionInUse ||= row.euRegionInUse;
    if (row.confidence === 'confirmed') prev.confidence = 'confirmed';
  }
  return [...byId.values()].sort(byRiskThenName);
}

export function detectFromSignals(signals, extraText = '') {
  return toVendorRows(detectVendors(signals), extraText);
}
