// Collects public signals about a domain: DNS records, HTTP headers, the
// Content-Security-Policy, and the third-party resources its homepage and its
// own scripts load.
import { Resolver } from 'node:dns/promises';
import { plural } from './plural.js';
import { safeFetch, normalizeDomain, FetchError } from './safe-fetch.js';
import { extractUrls, resourceUrls, cspHosts, isOwnHost } from './hosts.js';
import { checkPrivacyPolicy } from './privacy-policy.js';

export { extractUrls };

const MAX_OWN_SCRIPTS = 8;
const MAX_BUNDLE_TEXT = 3_000_000;

// Quad9 (Switzerland) first, Cloudflare second. Used when the system resolver
// refuses direct queries, which is common behind VPNs and local DNS proxies.
const FALLBACK_DNS = ['9.9.9.9', '149.112.112.112', '1.1.1.1'];
let resolverPromise;

function resolver() {
  resolverPromise ??= (async () => {
    const r = new Resolver({ timeout: 4000, tries: 2 });
    if (process.env.SCAN_DNS_SERVERS) {
      r.setServers(process.env.SCAN_DNS_SERVERS.split(',').map((s) => s.trim()));
      return r;
    }
    try {
      await r.resolveNs('iana.org');
      return r;
    } catch {
      const fallback = new Resolver({ timeout: 4000, tries: 2 });
      fallback.setServers(FALLBACK_DNS);
      return fallback;
    }
  })();
  return resolverPromise;
}

async function quiet(promise, fallback = []) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

async function collectDns(domain, r) {
  const [ns, mx, txt, apexCname, wwwCname, a] = await Promise.all([
    quiet(r.resolveNs(domain)),
    quiet(r.resolveMx(domain)),
    quiet(r.resolveTxt(domain)),
    quiet(r.resolveCname(domain)),
    quiet(r.resolveCname(`www.${domain}`)),
    quiet(r.resolve4(domain)),
  ]);
  const txtFlat = txt.map((parts) => parts.join(''));
  const spf = txtFlat.filter((t) => t.toLowerCase().startsWith('v=spf1'));
  const spfIncludes = spf.flatMap((record) => [...record.matchAll(/(?:include:|redirect=)(\S+)/gi)].map((m) => m[1]));

  // Follow CNAME chains one step: they often reveal the real host.
  const cname = [...apexCname, ...wwwCname];
  for (const name of [...cname]) cname.push(...(await quiet(r.resolveCname(name))));
  const ptr = (await Promise.all(a.slice(0, 2).map((ip) => quiet(r.reverse(ip))))).flat();

  return {
    ns,
    mx: mx.sort((x, y) => x.priority - y.priority).map((m) => m.exchange),
    txt: txtFlat.filter((t) => !t.toLowerCase().startsWith('v=spf1')),
    spf: [...spf, ...spfIncludes],
    cname,
    ptr,
    a,
  };
}

const BOT_WALL = /just a moment|cf-chl|challenge-platform|captcha|attention required|access denied|ddos-guard|perimeterx|px-captcha|datadome|incapsula|request unsuccessful/i;

/** True when the response is an anti-bot challenge rather than the real homepage. */
export function looksBlocked(res) {
  if (String(res.headers['cf-mitigated'] || '').toLowerCase().includes('challenge')) return true;
  if (![401, 403, 405, 429, 503].includes(res.status)) return false;
  return BOT_WALL.test(res.body.slice(0, 30_000));
}

async function fetchHomepage(domain) {
  const errors = [];
  let blocked = null;
  for (const candidate of [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`]) {
    try {
      const res = await safeFetch(candidate, { timeoutMs: 12_000 });
      if (looksBlocked(res)) {
        blocked ??= res;
        errors.push(`${candidate} showed an anti-bot challenge`);
      } else if (res.status < 500) {
        return { res, blocked: null, errors };
      } else {
        errors.push(`${candidate} answered ${res.status}`);
      }
    } catch (err) {
      if (err instanceof FetchError && err.code === 'PRIVATE') throw err;
      errors.push(`${candidate}: ${err.message}`);
    }
  }
  return { res: null, blocked, errors };
}

/**
 * @param {string} input domain or URL
 * @param {{ onProgress?: (step: {id:string, label:string, status:'running'|'done'|'skipped', detail?:string}) => void }} [opts]
 */
export async function collectDomainSignals(input, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const domain = normalizeDomain(input);
  const r = await resolver();
  const coverage = { dns: false, homepage: 'unreachable', scripts: 0, csp: false, privacyPolicy: 'not-found' };

  progress({ id: 'dns', label: 'Reading DNS records', status: 'running' });
  const dnsSignals = await collectDns(domain, r);
  if (!dnsSignals.a.length && !dnsSignals.ns.length && !dnsSignals.mx.length) {
    throw new FetchError(`${domain} has no public DNS records. Check the spelling.`, 'DNS');
  }
  coverage.dns = true;
  progress({ id: 'dns', label: 'Reading DNS records', status: 'done', detail: `${dnsSignals.mx.length} mail, ${dnsSignals.ns.length} nameserver, ${dnsSignals.txt.length + dnsSignals.spf.length} text records` });

  progress({ id: 'http', label: 'Loading the homepage', status: 'running' });
  const { res, blocked, errors } = await fetchHomepage(domain);
  const notes = [];
  const headers = res?.headers || blocked?.headers || {};
  let urls = [];
  let html = '';
  let privacyPolicy = null;
  /** Hosts the page loads from, for the "not in our database" list. */
  const seenHosts = [];

  const csp = cspHosts(headers);
  coverage.csp = csp.length > 0;
  const hosts = csp.map(({ host, wildcard }) => ({ host, wildcard, source: 'CSP header' }));
  for (const { host } of csp) seenHosts.push({ host, source: 'CSP header' });

  if (res) {
    coverage.homepage = 'ok';
    html = res.body;
    const resources = resourceUrls(html, res.url);
    urls = [...new Set([...extractUrls(html), ...resources.map((x) => x.url)])];
    for (const { url } of resources) {
      const host = new URL(url).hostname;
      seenHosts.push({ host, source: 'Page resource' });
      if (!isOwnHost(host, domain)) hosts.push({ host, source: 'Page resource' });
    }
    progress({ id: 'http', label: 'Loading the homepage', status: 'done', detail: `${res.status} from ${new URL(res.url).hostname}, ${plural(resources.length, 'resource')}` });

    progress({ id: 'scripts', label: 'Reading the site’s own scripts', status: 'running' });
    const allOwnScripts = resources
      .filter((x) => (x.tag === 'script' || x.tag === 'link') && /\.m?js(\?|$)/.test(new URL(x.url).pathname + new URL(x.url).search) && isOwnHost(new URL(x.url).hostname, domain))
      .map((x) => x.url);
    const ownScripts = allOwnScripts.slice(0, MAX_OWN_SCRIPTS);
    let bundleText = '';
    for (const src of ownScripts) {
      try {
        const js = await safeFetch(src, { timeoutMs: 8000, maxBytes: 1_500_000 });
        if (js.status === 200) {
          bundleText += `\n${js.body}`;
          coverage.scripts += 1;
        }
      } catch {
        /* a missing bundle is not fatal */
      }
    }
    urls = [...new Set([...urls, ...extractUrls(bundleText)])];
    if (bundleText) html += `\n${bundleText.slice(0, MAX_BUNDLE_TEXT)}`;
    progress({ id: 'scripts', label: 'Reading the site’s own scripts', status: 'done', detail: `${coverage.scripts} of ${plural(allOwnScripts.length, 'script file')} read` });

    progress({ id: 'policy', label: 'Reading the privacy policy', status: 'running' });
    privacyPolicy = await checkPrivacyPolicy(res.body, res.url);
    coverage.privacyPolicy = privacyPolicy.status;
    const policyDetail = {
      read: `${plural(privacyPolicy.namedVendorIds.length, 'known vendor')} named`,
      unreadable: 'found, but its text could not be read (it may be built by JavaScript)',
      'not-found': 'no privacy policy link found on the homepage',
    }[privacyPolicy.status];
    progress({ id: 'policy', label: 'Reading the privacy policy', status: privacyPolicy.status === 'read' ? 'done' : 'skipped', detail: policyDetail });
  } else if (blocked) {
    coverage.homepage = 'blocked';
    notes.push('The site blocked automated access, so only DNS, HTTP headers and the security policy were checked. Scripts on the page may hide more vendors: add --repo for a complete picture.');
    progress({ id: 'http', label: 'Loading the homepage', status: 'skipped', detail: 'blocked by an anti-bot check; using DNS and headers only' });
  } else {
    notes.push(...errors);
    progress({ id: 'http', label: 'Loading the homepage', status: 'skipped', detail: 'the site did not answer; using DNS only' });
  }

  return {
    domain,
    finalUrl: res?.url || null,
    httpStatus: res?.status ?? blocked?.status ?? null,
    tls: res?.tls ?? null,
    signals: { ...dnsSignals, headers, urls, html, hosts },
    seenHosts,
    privacyPolicy,
    coverage,
    notes,
  };
}
