// HTTP(S) GET that is safe to point at hosts supplied by untrusted users.
//
// - Resolves DNS once and pins the connection to the checked address, so a
//   second lookup cannot swap in a private IP (DNS rebinding).
// - Refuses loopback, private, link-local, CGNAT, multicast, documentation and
//   cloud-metadata addresses, including IPv4 addresses hidden inside IPv6.
// - Follows a limited number of redirects and checks every hop again.
// - Caps the total time and the body size of each request.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { VERSION } from './version.js';

const USER_AGENT = process.env.SCAN_USER_AGENT || `stackborder/${VERSION} (+https://www.npmjs.com/package/stackborder)`;

export class FetchError extends Error {
  /**
   * @param {string} message
   * @param {'INPUT'|'DNS'|'PRIVATE'|'PORT'|'PROTOCOL'|'TIMEOUT'|'REDIRECTS'|'NETWORK'|string} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function ipv4ToInt(ip) {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

/** [network, prefix length] pairs that must never be reached from a scanner. */
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // deprecated 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes broadcast
].map(([base, bits]) => ({ base: ipv4ToInt(base), size: 2 ** (32 - bits) }));

function isPrivateV4(ip) {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(({ base, size }) => n >= base && n < base + size);
}

/** Expands any valid IPv6 text form into eight 16-bit groups. */
function ipv6Groups(ip) {
  let text = ip.toLowerCase().replace(/%.*$/, ''); // drop a zone id such as %eth0
  const embedded = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) {
    const n = ipv4ToInt(embedded[1]);
    text = `${text.slice(0, -embedded[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array(missing).fill('0'), ...right].map((g) => parseInt(g, 16));
}

const groupsToV4 = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

function isPrivateV6(ip) {
  const g = ipv6Groups(ip);
  const allZeroUntil = (end) => g.slice(0, end).every((x) => x === 0);

  if (allZeroUntil(8)) return true; // :: unspecified
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1 loopback
  if (allZeroUntil(5) && g[5] === 0xffff) return isPrivateV4(groupsToV4(g[6], g[7])); // ::ffff:a.b.c.d mapped
  if (allZeroUntil(6)) return isPrivateV4(groupsToV4(g[6], g[7])); // ::a.b.c.d compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateV4(groupsToV4(g[6], g[7])); // 64:ff9b::/96 NAT64
  if (g[0] === 0x2002) return isPrivateV4(groupsToV4(g[1], g[2])); // 2002::/16 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // 2001::/32 Teredo tunnels
  return false;
}

/**
 * True when an address must not be reached from a public scanner.
 * Anything that is not a valid IP address counts as private: fail closed.
 * @param {string} ip
 */
export function isPrivateAddress(ip) {
  const address = String(ip).replace(/^\[|\]$/g, '');
  if (net.isIPv4(address)) return isPrivateV4(address);
  if (net.isIPv6(address)) return isPrivateV6(address);
  return true;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Resolves a host once and returns the address the connection will be pinned to. */
async function resolvePinned(hostname, allowPrivate) {
  const host = hostname.replace(/^\[|\]$/g, ''); // URL keeps brackets around IPv6 literals
  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateAddress(host)) throw new FetchError(`Refusing to connect to private address ${host}`, 'PRIVATE');
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FetchError(`Could not resolve ${host}`, 'DNS');
  }
  if (!records.length) throw new FetchError(`Could not resolve ${host}`, 'DNS');
  // Every record must be public: otherwise the OS could still pick the private one.
  if (!allowPrivate && records.some((r) => isPrivateAddress(r.address))) {
    throw new FetchError(`${host} points to a private network address`, 'PRIVATE');
  }
  return records.find((r) => r.family === 4) || records[0];
}

function requestOnce(url, { deadline, maxBytes, allowPrivate, headers }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    let req;
    const remaining = deadline - Date.now();
    const timer = setTimeout(() => {
      const err = new FetchError(`Timed out after ${Math.round(remaining)} ms`, 'TIMEOUT');
      req?.destroy(err);
      finish(reject, err);
    }, Math.max(0, remaining));

    resolvePinned(url.hostname, allowPrivate)
      .then((target) => {
        if (settled) return;
        const transport = url.protocol === 'https:' ? https : http;
        req = transport.request(
          url,
          {
            method: 'GET',
            headers: {
              'user-agent': USER_AGENT,
              accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
              'accept-language': 'en',
              ...headers,
            },
            // Connect to the address we checked, never to a fresh lookup.
            lookup: (_host, opts, cb) => {
              if (opts?.all) cb(null, [{ address: target.address, family: target.family }]);
              else cb(null, target.address, target.family);
            },
          },
          (res) => {
            const chunks = [];
            let size = 0;
            let truncated = false;
            res.on('data', (chunk) => {
              if (truncated) return;
              size += chunk.length;
              if (size > maxBytes) {
                truncated = true;
                chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
                res.destroy();
                return;
              }
              chunks.push(chunk);
            });
            const done = () =>
              finish(resolve, {
                status: res.statusCode || 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
                truncated,
                address: target.address,
                tls: url.protocol === 'https:',
              });
            res.on('end', done);
            res.on('close', done);
            res.on('error', (err) => finish(reject, new FetchError(err.message, 'NETWORK')));
          },
        );
        req.on('error', (err) => finish(reject, err instanceof FetchError ? err : new FetchError(err.message, 'NETWORK')));
        req.end();
      })
      .catch((err) => finish(reject, err));
  });
}

/**
 * GET a public URL with SSRF protection.
 * @param {string | URL} input
 * @param {{ timeoutMs?: number, maxBytes?: number, maxRedirects?: number, headers?: Record<string,string>, allowPrivate?: boolean }} [options]
 *   `timeoutMs` covers the whole request including redirects. `allowPrivate` exists for tests; never enable it for user input.
 */
export async function safeFetch(input, options = {}) {
  const { timeoutMs = 10_000, maxBytes = 2_000_000, maxRedirects = 4, allowPrivate = false, headers = {} } = options;
  const deadline = Date.now() + timeoutMs;
  let url = new URL(input);
  const redirects = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError(`Unsupported protocol ${url.protocol}`, 'PROTOCOL');
    if (url.port && url.port !== '80' && url.port !== '443' && !allowPrivate) throw new FetchError('Only ports 80 and 443 are allowed', 'PORT');
    if (url.username || url.password) throw new FetchError('URLs with credentials are not allowed', 'INPUT');

    const res = await requestOnce(url, { deadline, maxBytes, allowPrivate, headers });
    redirects.push({ url: url.href, status: res.status });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      url = new URL(res.headers.location, url);
      continue;
    }
    return { ...res, url: url.href, redirects };
  }
  throw new FetchError(`Stopped after ${maxRedirects} redirects`, 'REDIRECTS');
}

/**
 * Turns user input such as "https://WWW.Acme.eu/pricing" into a bare public hostname.
 * @param {string} input
 * @returns {string}
 */
export function normalizeDomain(input) {
  let text = String(input ?? '').trim().toLowerCase();
  if (!text) throw new FetchError('Enter a domain, for example acme.eu', 'INPUT');
  if (!/^https?:\/\//.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new FetchError(`"${input}" is not a valid domain`, 'INPUT');
  }
  const host = url.hostname.replace(/\.$/, '');
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw new FetchError(`"${input}" is not a valid public domain`, 'INPUT');
  }
  return host;
}
