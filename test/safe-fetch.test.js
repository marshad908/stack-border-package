import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, normalizeDomain, safeFetch, FetchError } from '../src/index.js';
import { startServer } from './helpers.js';

describe('isPrivateAddress', () => {
  const blocked = {
    'IPv4 loopback': '127.0.0.1',
    'IPv4 loopback range': '127.255.0.9',
    'private 10/8': '10.1.2.3',
    'private 172.16/12': '172.31.255.255',
    'private 192.168/16': '192.168.1.1',
    'cloud metadata': '169.254.169.254',
    'carrier-grade NAT': '100.64.0.1',
    'this network': '0.0.0.0',
    multicast: '224.0.0.1',
    broadcast: '255.255.255.255',
    'documentation range': '203.0.113.7',
    'IPv6 loopback': '::1',
    'IPv6 unspecified': '::',
    'IPv6 unique local': 'fd00::1',
    'IPv6 link-local': 'fe80::1',
    'IPv6 multicast': 'ff02::1',
    'IPv6 documentation': '2001:db8::1',
    'IPv4-mapped, dotted': '::ffff:127.0.0.1',
    'IPv4-mapped, hex (as URL prints it)': '::ffff:7f00:1',
    'IPv4-mapped metadata, hex': '::ffff:a9fe:a9fe',
    'IPv4-compatible': '::127.0.0.1',
    'NAT64 to loopback': '64:ff9b::7f00:1',
    '6to4 to loopback': '2002:7f00:1::1',
    'Teredo tunnel': '2001:0:4136:e378::1',
    'bracketed IPv6 literal': '[::1]',
    'IPv6 with zone id': 'fe80::1%eth0',
    'not an address': 'example.com',
    'empty string': '',
  };
  for (const [label, ip] of Object.entries(blocked)) {
    it(`blocks ${label} (${ip || 'empty'})`, () => assert.equal(isPrivateAddress(ip), true));
  }

  const allowed = {
    'public IPv4': '8.8.8.8',
    'Hetzner IPv4': '95.216.1.1',
    'just outside 172.16/12': '172.32.0.1',
    'public IPv6': '2a01:4f8::1',
    'IPv4-mapped public': '::ffff:8.8.8.8',
    'NAT64 to public': '64:ff9b::808:808',
  };
  for (const [label, ip] of Object.entries(allowed)) {
    it(`allows ${label} (${ip})`, () => assert.equal(isPrivateAddress(ip), false));
  }
});

describe('normalizeDomain', () => {
  it('strips scheme, path, case and trailing dot', () => {
    assert.equal(normalizeDomain('https://WWW.Acme.EU/pricing?x=1'), 'www.acme.eu');
    assert.equal(normalizeDomain('  acme.eu.  '), 'acme.eu');
    assert.equal(normalizeDomain('http://shop.acme.co.uk'), 'shop.acme.co.uk');
  });

  for (const input of ['', '   ', 'localhost', 'not a domain', '127.0.0.1', 'acme', '-acme.eu', `${'a'.repeat(64)}.eu`]) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      assert.throws(() => normalizeDomain(input), (err) => err instanceof FetchError && err.code === 'INPUT');
    });
  }
});

describe('safeFetch guards (no network needed)', () => {
  const cases = [
    ['loopback IP', 'http://127.0.0.1/', 'PRIVATE'],
    ['localhost name', 'http://localhost/', 'PRIVATE'],
    ['IPv6 loopback literal', 'http://[::1]/', 'PRIVATE'],
    ['IPv4-mapped IPv6 literal', 'http://[::ffff:127.0.0.1]/', 'PRIVATE'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/', 'PRIVATE'],
    ['non-web port', 'http://8.8.8.8:8080/', 'PORT'],
    ['file protocol', 'file:///etc/passwd', 'PROTOCOL'],
    ['ftp protocol', 'ftp://example.com/', 'PROTOCOL'],
    ['credentials in URL', 'https://user:pass@example.com/', 'INPUT'],
  ];
  for (const [label, url, code] of cases) {
    it(`refuses ${label}`, async () => {
      await assert.rejects(safeFetch(url), (err) => err instanceof FetchError && err.code === code);
    });
  }
});

describe('safeFetch against a local server', () => {
  let server;
  before(async () => {
    server = await startServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/html', 'x-test': 'yes' });
        res.end('<h1>hello</h1>');
      } else if (req.url === '/big') {
        res.writeHead(200);
        res.end('x'.repeat(50_000));
      } else if (req.url === '/hop') {
        res.writeHead(302, { location: '/ok' });
        res.end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        res.end();
      } else if (req.url === '/to-file') {
        res.writeHead(302, { location: 'file:///etc/passwd' });
        res.end();
      } else if (req.url === '/slow') {
        res.writeHead(200);
        const timer = setInterval(() => res.write('.'), 50); // trickles forever
        res.on('close', () => clearInterval(timer));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  after(() => server.close());

  // allowPrivate is needed to reach 127.0.0.1; every other guard still applies.
  const fetchLocal = (p, opts = {}) => safeFetch(`${server.url}${p}`, { allowPrivate: true, ...opts });

  it('returns status, headers, body and the pinned address', async () => {
    const res = await fetchLocal('/ok');
    assert.equal(res.status, 200);
    assert.equal(res.body, '<h1>hello</h1>');
    assert.equal(res.headers['x-test'], 'yes');
    assert.equal(res.address, '127.0.0.1');
    assert.equal(res.truncated, false);
    assert.equal(res.tls, false);
  });

  it('sends a descriptive User-Agent', async () => {
    let seen;
    const probe = await startServer((req, res) => {
      seen = req.headers['user-agent'];
      res.end();
    });
    try {
      await safeFetch(`${probe.url}/`, { allowPrivate: true });
      assert.match(seen, /^stackborder\/\d+\.\d+\.\d+/);
    } finally {
      await probe.close();
    }
  });

  it('follows redirects and records the chain', async () => {
    const res = await fetchLocal('/hop');
    assert.equal(res.status, 200);
    assert.ok(res.url.endsWith('/ok'));
    assert.deepEqual(res.redirects.map((r) => r.status), [302, 200]);
  });

  it('stops redirect loops', async () => {
    await assert.rejects(fetchLocal('/loop', { maxRedirects: 3 }), { code: 'REDIRECTS' });
  });

  it('re-checks the protocol of every redirect hop', async () => {
    await assert.rejects(fetchLocal('/to-file'), { code: 'PROTOCOL' });
  });

  it('cuts the body off at maxBytes', async () => {
    const res = await fetchLocal('/big', { maxBytes: 1000 });
    assert.equal(res.truncated, true);
    assert.equal(res.body.length, 1000);
  });

  it('enforces a total time limit even while data keeps arriving', async () => {
    const started = Date.now();
    await assert.rejects(fetchLocal('/slow', { timeoutMs: 400 }), { code: 'TIMEOUT' });
    assert.ok(Date.now() - started < 2000, 'gave up close to the limit');
  });
});
