import { collectDomainSignals } from './domain-scan.js';
import { collectRepoSignals } from './repo-scan.js';
import { detectFromSignals, buildReport, toVendorRows } from './report.js';
import { unrecognizedDomains } from './detect.js';
import { isOwnHost } from './hosts.js';
import { getVendor } from './vendors.js';
import { plural } from './plural.js';

/**
 * Scans a public domain and returns a sovereignty report.
 * @param {string} domain
 * @param {{ onProgress?: Function }} [opts]
 */
export async function scanDomain(domain, opts = {}) {
  const collected = await collectDomainSignals(domain, opts);
  opts.onProgress?.({ id: 'match', label: 'Matching vendors', status: 'running' });

  const { signals } = collected;
  const vendors = detectFromSignals(signals, signals.html.slice(0, 500_000));
  const unrecognized = unrecognizedDomains(
    collected.seenHosts,
    (host) => isOwnHost(host, collected.domain),
    new Map(vendors.map((v) => [v.id, v.evidence])),
  );

  const detail = `${plural(vendors.length, 'vendor')} found${unrecognized.length ? `, ${plural(unrecognized.length, 'unrecognized domain')}` : ''}`;
  opts.onProgress?.({ id: 'match', label: 'Matching vendors', status: 'done', detail });

  return buildReport({
    target: collected.domain,
    kind: 'domain',
    vendors,
    unrecognized,
    coverage: collected.coverage,
    privacyPolicy: collected.privacyPolicy,
    notes: collected.notes,
    meta: {
      finalUrl: collected.finalUrl,
      httpStatus: collected.httpStatus,
      tls: collected.tls,
      dns: { ns: signals.ns, mx: signals.mx, spf: signals.spf, cname: signals.cname, ptr: signals.ptr, a: signals.a },
    },
  });
}

/** Scans a local repository: manifests, deploy configs, API hosts in source code and .env templates. */
export async function scanRepo(dir) {
  const collected = await collectRepoSignals(dir);
  const found = new Map(detectFromSignals(collected.signals).map((row) => [row.id, row]));

  for (const { vendorId, file } of collected.configVendors) {
    const evidence = { source: 'Deploy config', value: file };
    if (found.has(vendorId)) found.get(vendorId).evidence.push(evidence);
    else if (getVendor(vendorId)) found.set(vendorId, toVendorRows(new Map([[vendorId, [evidence]]]))[0]);
  }

  const notes = collected.coverage.truncated
    ? ['This repository is very large: only part of the source code was read. Scan a sub-folder for full coverage.']
    : [];

  return buildReport({
    target: collected.root,
    kind: 'repo',
    vendors: [...found.values()],
    coverage: { repo: collected.coverage },
    notes,
    meta: { manifests: collected.manifests, packages: collected.signals.npm.length + collected.signals.pypi.length },
  });
}

export { VERSION } from './version.js';
export { safeFetch, normalizeDomain, isPrivateAddress, FetchError } from './safe-fetch.js';
export { loadVendorDb, listVendors, getVendor, alternativesFor, categoryLabel, CATEGORY_LABELS } from './vendors.js';
export { regionOf, countryName, cloudActExposed, REGION_LABELS, EU_MEMBERS } from './jurisdiction.js';
export { computeScore, jurisdictionFactor, categoryWeight, gradeFor, CATEGORY_WEIGHTS } from './score.js';
export { detectVendors, containsToken, unrecognizedDomains } from './detect.js';
export { buildReport, mergeVendorRows, toVendorRows, DISCLAIMER } from './report.js';
export { suggestAiSystems, HIGH_RISK_AREAS, RISK_TIERS, TRANSPARENCY_DUTIES } from './ai-act.js';
export { snapshotPage, htmlToLines, hashLines, diffLines } from './page-watch.js';
export { extractUrls, resourceUrls, cspHosts, registrableDomain, hostnameCandidates } from './hosts.js';
export { looksBlocked } from './domain-scan.js';
export { checkPrivacyPolicy, vendorsNamedIn } from './privacy-policy.js';
