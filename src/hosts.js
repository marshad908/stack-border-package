// Helpers for pulling hostnames and URLs out of HTML, HTTP headers and source code.

const URL_RE = /(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/?#][^\s"'<>)\\`]*)?/gi;

/** Every absolute or protocol-relative URL in a text, normalized to https://host/path. */
export function extractUrls(text) {
  const out = new Set();
  for (const match of String(text).matchAll(URL_RE)) {
    const raw = match[0].startsWith('//') ? `https:${match[0]}` : match[0];
    try {
      const u = new URL(raw);
      out.add(`https://${u.hostname}${u.pathname}`.slice(0, 300));
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

// Second-level labels used under country domains, as in example.co.uk or example.com.au.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ltd', 'plc']);

/**
 * The part of a hostname a company registers: cdn.shop.acme.co.uk -> acme.co.uk.
 * A small heuristic, not the full Public Suffix List, which is enough for grouping.
 */
export function registrableDomain(host) {
  const labels = String(host).toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const [sld, tld] = labels.slice(-2);
  const keep = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/**
 * True when `host` belongs to the scanned site: its subdomains, or the same
 * brand on another top-level domain (linear.app also serves from linear.dev).
 * Brands shorter than four letters are too ambiguous for the second rule.
 */
export function isOwnHost(host, siteDomain) {
  const own = registrableDomain(siteDomain.replace(/^www\./, ''));
  const other = registrableDomain(host);
  if (other === own) return true;
  const brand = (domain) => domain.split('.')[0];
  return brand(own).length >= 4 && brand(other) === brand(own);
}

// Tags that make the browser load something. Plain links (<a href>) are not data flows.
const RESOURCE_TAG = /<(script|iframe|img|source|video|audio|embed|link)\b([^>]*)>/gi;
const LINK_REL_LOADS = /\brel=["']?[^"'>]*\b(stylesheet|preload|modulepreload|prefetch|preconnect|dns-prefetch|icon)\b/i;

/**
 * Absolute URLs of resources a page loads: scripts, frames, images, media,
 * stylesheets and connection hints (preconnect, dns-prefetch).
 * @param {string} html
 * @param {string} pageUrl used to resolve relative URLs
 * @returns {{ url: string, tag: string }[]}
 */
export function resourceUrls(html, pageUrl) {
  const out = [];
  const seen = new Set();
  for (const [, tag, attrs] of String(html).matchAll(RESOURCE_TAG)) {
    const name = tag.toLowerCase();
    if (name === 'link' && !LINK_REL_LOADS.test(attrs)) continue;
    const value = attrs.match(/\b(?:src|href)=["']?([^"'\s>]+)/i)?.[1];
    if (!value || value.startsWith('data:')) continue;
    try {
      const url = new URL(value, pageUrl).href;
      if (!seen.has(url) && url.startsWith('http')) {
        seen.add(url);
        out.push({ url, tag: name });
      }
    } catch {
      /* invalid URL */
    }
  }
  return out;
}

const CSP_KEYWORDS = /^'|^(data|blob|mediastream|filesystem|https?|wss?):?$/i;

/**
 * Hostnames listed in Content-Security-Policy headers. A CSP names every origin
 * the site may load from or send data to, including scripts injected at runtime.
 * Wildcards such as *.stripe.com are returned as "stripe.com" with `wildcard: true`.
 * @param {Record<string, string | string[] | undefined>} headers
 * @returns {{ host: string, wildcard: boolean }[]}
 */
export function cspHosts(headers) {
  const policies = [headers['content-security-policy'], headers['content-security-policy-report-only']]
    .flat()
    .filter(Boolean)
    .join(';');
  const found = new Map();
  for (const directive of policies.split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (!name || /^(report-uri|report-to|sandbox|upgrade-insecure-requests)$/i.test(name)) continue;
    for (const source of sources) {
      if (CSP_KEYWORDS.test(source)) continue;
      const bare = source.replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '').toLowerCase();
      const wildcard = bare.startsWith('*.');
      const host = wildcard ? bare.slice(2) : bare;
      // IP addresses (127.0.0.1 for local development) are not vendors.
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^[\d.]+$/.test(host)) continue;
      found.set(host, { host, wildcard: wildcard || found.get(host)?.wildcard === true });
    }
  }
  return [...found.values()];
}

// File-name endings that look like hostnames in code ("index.ts", "user.name").
const NOT_A_TLD = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'css', 'scss', 'html', 'htm', 'md', 'mdx', 'png', 'jpg', 'jpeg', 'gif',
  'svg', 'webp', 'ico', 'py', 'rb', 'go', 'rs', 'php', 'java', 'kt', 'cs', 'yml', 'yaml', 'toml', 'lock', 'txt', 'map',
  'env', 'sh', 'sql', 'vue', 'svelte', 'astro', 'xml', 'pdf', 'zip', 'gz', 'wasm', 'log', 'test', 'spec', 'd',
  'length', 'name', 'value', 'then', 'catch', 'map', 'filter', 'push', 'get', 'set', 'data', 'id', 'type', 'url', 'body',
]);

/**
 * Strings in source code that look like hostnames, such as "api.openai.com"
 * in `fetch('https://api.openai.com/v1')` or `host: 'smtp.sendgrid.net'`.
 * @param {string} text
 * @returns {Set<string>}
 */
export function hostnameCandidates(text) {
  const out = new Set();
  for (const [candidate] of String(text).matchAll(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\b/gi)) {
    const host = candidate.toLowerCase();
    const tld = host.slice(host.lastIndexOf('.') + 1);
    if (tld.length < 2 || tld.length > 24 || /\d/.test(tld) || NOT_A_TLD.has(tld)) continue;
    out.add(host);
  }
  return out;
}
