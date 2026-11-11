// Turns a vendor's subprocessor web page into comparable lines of text,
// so two versions of the page can be diffed to spot added or removed companies.
import { createHash } from 'node:crypto';
import { safeFetch } from './safe-fetch.js';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

/** Decodes one HTML entity; leaves it untouched when it is unknown or invalid. */
function decodeEntity(match, body) {
  if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

// Lines that change on every page load and say nothing about subprocessors.
const NOISE = /^(©|copyright\b|last (updated|modified)\b|\d{1,2}:\d{2})/i;

/**
 * Visible text of an HTML page as unique, whitespace-normalised lines, in page order.
 * @param {string} html
 * @returns {string[]}
 */
export function htmlToLines(html) {
  const text = String(html)
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/th|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity);

  const seen = new Set();
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length < 2 || NOISE.test(line) || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

/** Stable fingerprint of a page's lines. */
export function hashLines(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Set-based line diff. Order changes are ignored on purpose: for lists of
 * companies only additions and removals matter.
 * @param {string[]} before
 * @param {string[]} after
 */
export function diffLines(before, after) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: after.filter((line) => !was.has(line)),
    removed: before.filter((line) => !now.has(line)),
  };
}

/**
 * Downloads a public page and returns its normalised lines and their hash.
 * @param {string} url
 */
export async function snapshotPage(url) {
  const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 3_000_000 });
  if (res.status >= 400) throw new Error(`${url} answered with HTTP ${res.status}`);
  const lines = htmlToLines(res.body);
  return { url: res.url, status: res.status, lines, hash: hashLines(lines), fetchedAt: new Date().toISOString() };
}
