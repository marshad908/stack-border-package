// Turns raw signals (DNS records, headers, URLs, hostnames, package names,
// environment variable names) into vendor findings with evidence.
import { listVendors } from './vendors.js';
import { registrableDomain } from './hosts.js';

/**
 * Case-insensitive "contains" that refuses matches glued to a longer label,
 * so "cal.com" does not match "fiscal.com". Needles that start with a dot or
 * slash are already anchored and skip the check.
 */
export function containsToken(haystack, needle) {
  const h = String(haystack).toLowerCase();
  const n = String(needle).toLowerCase();
  if (!n) return false;
  const anchored = !/^[a-z0-9]/.test(n);
  let from = 0;
  while (true) {
    const at = h.indexOf(n, from);
    if (at === -1) return false;
    if (anchored || at === 0 || !/[a-z0-9-]/.test(h[at - 1])) return true;
    from = at + 1;
  }
}

function matchPackage(name, pattern) {
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  return p.endsWith('/') || p.endsWith('-') ? n.startsWith(p) : n === p;
}

// Frameworks expose variables to the browser under a prefix; the vendor name follows it.
const PUBLIC_ENV_PREFIX = /^(NEXT_PUBLIC_|NUXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|GATSBY_)/;

function matchEnv(key, pattern) {
  const name = key.toUpperCase().replace(PUBLIC_ENV_PREFIX, '');
  return pattern.endsWith('_') ? name.startsWith(pattern) : name === pattern;
}

function matchHeader(headers, pattern) {
  const sep = pattern.indexOf(':');
  const name = (sep === -1 ? pattern : pattern.slice(0, sep)).toLowerCase();
  const value = headers[name];
  if (value === undefined) return null;
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  if (sep === -1) return `${name}: ${text}`.slice(0, 120);
  return text.toLowerCase().includes(pattern.slice(sep + 1).toLowerCase()) ? `${name}: ${text}`.slice(0, 120) : null;
}

/** Script and API patterns that are plain hostnames, usable against hostnames found in code or a CSP. */
function hostPatterns(vendor) {
  const d = vendor.detect || {};
  return [...(d.host || []), ...(d.script || []), ...(d.html || [])].filter((p) => /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(p));
}

/** Patterns that are a hostname plus a path (googletagmanager.com/gtag/js): plain hostnames are matched as hosts. */
function urlPatterns(vendor) {
  const d = vendor.detect || {};
  return [...(d.script || []), ...(d.html || [])].filter((p) => /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+\/\S+$/i.test(p));
}

// Platforms that host other companies' apps: foo.vercel.app is some third party, not Vercel itself.
const APP_PLATFORMS = new Set([
  'vercel.app', 'netlify.app', 'herokuapp.com', 'azurewebsites.net', 'github.io', 'pages.dev', 'workers.dev',
  'fly.dev', 'onrender.com', 'firebaseapp.com', 'web.app', 'appspot.com',
]);

// Infrastructure domains shared by many products of one large provider: known, but not one vendor.
const MULTI_PRODUCT = new Set([
  'amazonaws.com', 'cloudfront.net', 'googleapis.com', 'gstatic.com', 'google.com', 'windows.net', 'azureedge.net',
  'cloudflare.com', 'akamaized.net', 'fastly.net',
]);

const SHARED_HOSTING = new Set([...APP_PLATFORMS, ...MULTI_PRODUCT]);

let domainIndex;
/** registrable domain -> ids of vendors whose hostname patterns use it. */
function vendorDomainIndex() {
  if (!domainIndex) {
    domainIndex = new Map();
    for (const vendor of listVendors()) {
      for (const pattern of hostPatterns(vendor)) {
        const base = registrableDomain(pattern.replace(/^\.|\.$/g, ''));
        if (!base.includes('.')) continue;
        if (!domainIndex.has(base)) domainIndex.set(base, new Set());
        domainIndex.get(base).add(vendor.id);
      }
    }
  }
  return domainIndex;
}

/** The single vendor owning a domain, or null when it is unknown, shared or ambiguous. */
function vendorForDomain(host) {
  const base = registrableDomain(host);
  if (SHARED_HOSTING.has(base)) return null;
  const ids = vendorDomainIndex().get(base);
  return ids && ids.size === 1 ? [...ids][0] : null;
}

/** True when the database knows the domain, even if it cannot be pinned to one vendor. */
export function isKnownVendorDomain(host) {
  const base = registrableDomain(host);
  if (APP_PLATFORMS.has(base)) return false;
  return MULTI_PRODUCT.has(base) || vendorDomainIndex().has(base);
}

/**
 * @typedef {object} Signals
 * @property {string[]} [ns] @property {string[]} [mx] @property {string[]} [spf] @property {string[]} [txt]
 * @property {string[]} [cname] @property {string[]} [ptr]
 * @property {Record<string,string|string[]|undefined>} [headers]
 * @property {string[]} [urls] URLs loaded or referenced by a page
 * @property {string} [html] page source, matched against code snippets
 * @property {{ host: string, source: string, where?: string, wildcard?: boolean }[]} [hosts] hostnames from a CSP or from source code
 * @property {{ url: string, where: string }[]} [sourceUrls] full URLs written in source code
 * @property {string[]} [npm] @property {string[]} [pypi]
 * @property {{ key: string, file: string }[]} [envKeys] variable names from .env.example files
 */

/**
 * @param {Signals} signals
 * @returns {Map<string, {source:string, value:string}[]>} vendorId -> evidence
 */
export function detectVendors(signals) {
  const found = new Map();
  const add = (vendorId, source, value) => {
    const list = found.get(vendorId) || [];
    if (!list.some((e) => e.source === source && e.value === value) && list.length < 6) list.push({ source, value });
    found.set(vendorId, list);
  };
  const listChecks = [
    ['ns', 'DNS nameserver'],
    ['mx', 'DNS MX'],
    ['spf', 'SPF record'],
    ['txt', 'DNS TXT'],
    ['cname', 'DNS CNAME'],
    ['ptr', 'Reverse DNS'],
  ];
  const hosts = signals.hosts || [];

  for (const vendor of listVendors()) {
    const d = vendor.detect || {};
    for (const [key, source] of listChecks) {
      for (const pattern of d[key] || []) {
        for (const value of signals[key] || []) {
          if (containsToken(value, pattern)) add(vendor.id, source, value.slice(0, 160));
        }
      }
    }
    if (signals.headers) {
      for (const pattern of d.header || []) {
        const hit = matchHeader(signals.headers, pattern);
        if (hit) add(vendor.id, 'HTTP header', hit);
      }
    }
    for (const pattern of d.script || []) {
      const url = (signals.urls || []).find((u) => containsToken(u.replace(/^https?:\/\//, ''), pattern));
      if (url) add(vendor.id, 'Page resource', url.slice(0, 160));
    }
    if (signals.html) {
      for (const pattern of d.html || []) {
        if (containsToken(signals.html, pattern)) add(vendor.id, 'Page code', pattern);
      }
    }
    for (const pattern of urlPatterns(vendor)) {
      const hit = (signals.sourceUrls || []).find((u) => containsToken(u.url.replace(/^https?:\/\//, ''), pattern));
      if (hit) add(vendor.id, 'Source code', `${hit.where}: ${hit.url}`.slice(0, 160));
    }
    for (const pattern of hostPatterns(vendor)) {
      for (const h of hosts) {
        if (containsToken(h.host, pattern.replace(/\.$/, ''))) add(vendor.id, h.source, h.where ? `${h.where}: ${h.host}` : h.host);
      }
    }
    for (const [key, source] of [['npm', 'npm package'], ['pypi', 'Python package']]) {
      for (const pattern of d[key] || []) {
        for (const pkg of signals[key] || []) {
          if (matchPackage(pkg, pattern)) add(vendor.id, source, pkg);
        }
      }
    }
    for (const pattern of d.env || []) {
      for (const { key, file } of signals.envKeys || []) {
        if (matchEnv(key, pattern)) add(vendor.id, 'Env example', `${file}: ${key}`);
      }
    }
  }

  // A CSP wildcard such as *.stripe.com names a whole vendor domain: credit it when only one vendor owns it.
  for (const h of hosts) {
    if (!h.wildcard) continue;
    const id = vendorForDomain(h.host);
    if (id) add(id, h.source, `*.${h.host}`);
  }

  // A more specific product wins over its parent platform when the only evidence is shared.
  for (const [child, prefix] of [['amazon-ses', '@aws-sdk/client-ses'], ['aws-bedrock', '@aws-sdk/client-bedrock']]) {
    if (found.has(child) && found.has('aws') && found.get('aws').every((e) => e.value.startsWith(prefix))) found.delete('aws');
  }
  if (found.has('azure-openai') && found.has('azure') && found.get('azure').every((e) => /openai/i.test(e.value))) found.delete('azure');
  return found;
}

/** True when the evidence shows the vendor's EU data region is in use (e.g. eu.posthog.com). */
export function usesEuRegion(vendor, evidence, extraText = '') {
  if (!vendor.euSignals?.length) return false;
  const haystack = `${evidence.map((e) => e.value).join(' ')} ${extraText}`.toLowerCase();
  return vendor.euSignals.some((s) => haystack.includes(s.toLowerCase()));
}

// Domains that appear in markup but never receive visitor data.
const NOISE_DOMAINS = new Set(['w3.org', 'schema.org', 'ogp.me', 'purl.org', 'xmlns.com', 'example.com', 'example.org', 'example.net', 'creativecommons.org']);

/**
 * Third-party domains the site loads from that match no vendor in the database.
 * Shown to the user so nothing is silently left out of the report.
 * @param {{ host: string, source: string }[]} seen hosts the page loads from
 * @param {(host: string) => boolean} isOwn
 * @param {Map<string, {value:string}[]>} detected
 * @returns {{ domain: string, hosts: string[], source: string }[]}
 */
export function unrecognizedDomains(seen, isOwn, detected) {
  const evidenceText = [...detected.values()].flat().map((e) => e.value.toLowerCase()).join(' ');
  const byDomain = new Map();
  for (const { host, source } of seen) {
    const domain = registrableDomain(host);
    if (isOwn(host) || NOISE_DOMAINS.has(domain) || isKnownVendorDomain(host) || evidenceText.includes(host)) continue;
    const entry = byDomain.get(domain) || { domain, hosts: [], source };
    if (!entry.hosts.includes(host) && entry.hosts.length < 5) entry.hosts.push(host);
    byDomain.set(domain, entry);
  }
  return [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain)).slice(0, 30);
}
