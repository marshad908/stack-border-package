// Finds a site's privacy policy and subprocessor page, and checks which vendors they name.
// GDPR asks companies to tell visitors who receives their data, so a vendor that the scan
// finds but the policy never names is worth a look.
import { safeFetch } from './safe-fetch.js';
import { htmlToLines } from './page-watch.js';
import { listVendors } from './vendors.js';

// Link text or address of a privacy policy, in the languages most EU sites use.
const PRIVACY_LINK = /privacy|datenschutz|confidentialit|privacidad|privacit|privacybeleid|integritet|personvern|tietosuoja|prywatno/i;
const SUBPROCESSOR_LINK = /sub-?processors?|unterauftragsverarbeiter|sous-traitants/i;
const FALLBACK_PATHS = ['/privacy-policy', '/privacy'];

// Words every privacy policy uses. A page without them is not a policy (for example a homepage
// that a single-page app serves for every path).
const POLICY_WORDS = /personal data|personal information|privacy|datenschutz|données personnelles|datos personales|dati personali|persoonsgegevens|GDPR|DSGVO|RGPD/i;

// A policy shorter than this was most likely rendered by JavaScript, so its text cannot be judged.
const MIN_READABLE_CHARS = 1500;

// Many policies name the company rather than the product ("Google", "AWS"): that counts as named.
const COMPANY_NAMES = {
  Google: ['Google'],
  Microsoft: ['Microsoft', 'Azure'],
  Amazon: ['Amazon', 'AWS'],
  Meta: ['Meta', 'Facebook', 'Instagram'],
  Adobe: ['Adobe'],
  Salesforce: ['Salesforce'],
  Oracle: ['Oracle'],
  Twilio: ['Twilio'],
  Atlassian: ['Atlassian'],
  Cloudflare: ['Cloudflare'],
};

/** Links in a page whose address or text looks like a privacy policy or a subprocessor list. */
export function findPolicyLinks(html, baseUrl) {
  const privacy = [];
  const subprocessors = [];
  for (const [, href, text] of String(html).matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (href.startsWith('#')) continue;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const label = `${url.pathname} ${text.replace(/<[^>]+>/g, ' ')}`;
    url.hash = '';
    if (SUBPROCESSOR_LINK.test(label)) subprocessors.push(url.href);
    else if (PRIVACY_LINK.test(label)) privacy.push({ href: url.href, rank: policyRank(url.pathname, text) });
  }
  // The best match first: a marketing page such as /privacy-focused-analytics also says "privacy".
  const ranked = privacy.sort((a, b) => b.rank - a.rank).map((link) => link.href);
  return { privacy: [...new Set(ranked)], subprocessors: [...new Set(subprocessors)] };
}

/** How much a privacy link looks like the policy itself rather than a page that mentions privacy. */
function policyRank(pathname, linkHtml) {
  const text = linkHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let rank = 0;
  if (/\/(privacy|datenschutz)[-_]?(policy|notice|statement|erklaerung|erklärung)?(\.html?)?\/?$/i.test(pathname)) rank += 2;
  if (/polic|legal|notice|statement|gdpr|datenschutz/i.test(pathname)) rank += 1;
  if (/^(privacy|data protection|datenschutz\S*|politique de confidentialit\S*)( policy| notice| statement)?$/i.test(text)) rank += 2;
  return rank;
}

/** True when `name` appears as a whole word that starts with a capital, so "we may resend" is not "Resend". */
function namesProperNoun(text, name) {
  const lower = text.toLowerCase();
  const needle = name.toLowerCase();
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
    const before = text[at - 1];
    const after = text[at + needle.length];
    const wholeWord = !(before && /[\p{L}\p{N}]/u.test(before)) && !(after && /[\p{L}\p{N}]/u.test(after));
    // Names written in lower case on purpose (bunny.net) may match in lower case too.
    if (wholeWord && (!/\p{Ll}/u.test(text[at]) || /^\p{Ll}/u.test(name))) return true;
  }
  return false;
}

/** A vendor named like a domain ("bunny.net") is often written without it ("Bunny"). */
function nameVariants(name) {
  const domainLike = /^([a-z0-9-]+)\.[a-z]{2,}$/i.exec(name);
  return domainLike ? [name, domainLike[1][0].toUpperCase() + domainLike[1].slice(1)] : [name];
}

/** Ids of every vendor in the database that a text names, by product or by company. */
export function vendorsNamedIn(text) {
  const companiesNamed = Object.values(COMPANY_NAMES).filter((aliases) => aliases.some((alias) => namesProperNoun(text, alias)));

  const named = new Set();
  for (const vendor of listVendors()) {
    const byCompany = companiesNamed.some((aliases) => aliases.some((alias) => namesProperNoun(vendor.name, alias)));
    if (byCompany || nameVariants(vendor.name).some((name) => namesProperNoun(text, name))) named.add(vendor.id);
  }
  return named;
}

async function readPage(url) {
  try {
    const res = await safeFetch(url, { timeoutMs: 10_000, maxBytes: 3_000_000 });
    if (res.status >= 400) return null;
    const text = htmlToLines(res.body).join('\n');
    return POLICY_WORDS.test(text) ? { url: res.url, text, html: res.body } : null;
  } catch {
    return null;
  }
}

/**
 * Reads the privacy policy (and subprocessor page, when the homepage links one).
 * @param {string} homepageHtml
 * @param {string} homepageUrl final URL of the homepage
 * @returns {Promise<{ status: 'read'|'unreadable'|'not-found', url: string|null, subprocessorsUrl: string|null, namedVendorIds: string[] }>}
 */
export async function checkPrivacyPolicy(homepageHtml, homepageUrl) {
  const links = findPolicyLinks(homepageHtml, homepageUrl);
  const candidates = links.privacy.length ? links.privacy.slice(0, 2) : FALLBACK_PATHS.map((p) => new URL(p, homepageUrl).href);

  let policy = null;
  for (const url of candidates) {
    policy = await readPage(url);
    if (policy) break;
  }
  // The subprocessor list is often linked from the policy rather than from the homepage.
  const subprocessorLink = links.subprocessors[0] ?? (policy && findPolicyLinks(policy.html, policy.url).subprocessors[0]);
  const subprocessors = subprocessorLink ? await readPage(subprocessorLink) : null;

  const pages = [policy, subprocessors].filter(Boolean);
  const text = pages.map((p) => p.text).join('\n');
  let status = 'read';
  if (!pages.length) status = 'not-found';
  else if (text.length < MIN_READABLE_CHARS) status = 'unreadable';

  return {
    status,
    url: policy?.url ?? null,
    subprocessorsUrl: subprocessors?.url ?? null,
    namedVendorIds: status === 'read' ? [...vendorsNamedIn(text)].sort() : [],
  };
}
