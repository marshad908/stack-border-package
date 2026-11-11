import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, resourceUrls, cspHosts, registrableDomain, hostnameCandidates } from '../src/index.js';
import { isOwnHost } from '../src/hosts.js';

describe('registrableDomain', () => {
  it('keeps the registered part of a hostname', () => {
    assert.equal(registrableDomain('cdn.shop.acme.com'), 'acme.com');
    assert.equal(registrableDomain('acme.com'), 'acme.com');
    assert.equal(registrableDomain('ACME.com.'), 'acme.com');
  });

  it('understands second-level country domains', () => {
    assert.equal(registrableDomain('www.acme.co.uk'), 'acme.co.uk');
    assert.equal(registrableDomain('api.acme.com.au'), 'acme.com.au');
    // .co as a top-level domain is not a second level
    assert.equal(registrableDomain('www.acme.co'), 'acme.co');
  });
});

describe('isOwnHost', () => {
  it('accepts the site, its subdomains and the www form', () => {
    assert.ok(isOwnHost('static.acme.eu', 'acme.eu'));
    assert.ok(isOwnHost('acme.eu', 'www.acme.eu'));
  });

  it('accepts the same brand on another top-level domain', () => {
    assert.ok(isOwnHost('static.linear.dev', 'linear.app'));
  });

  it('rejects other companies, and short brands that collide easily', () => {
    assert.ok(!isOwnHost('js.stripe.com', 'acme.eu'));
    assert.ok(!isOwnHost('abc.net', 'abc.com'));
  });
});

describe('extractUrls', () => {
  it('normalises absolute and protocol-relative URLs to https', () => {
    const urls = extractUrls('<script src="//cdn.example.org/a.js?x=1"></script> fetch("http://api.acme.io/v1")');
    assert.deepEqual(urls.sort(), ['https://api.acme.io/v1', 'https://cdn.example.org/a.js']);
  });

  it('ignores text that only looks like a URL', () => {
    assert.deepEqual(extractUrls('version 1.2.3 and //comment'), []);
  });
});

describe('resourceUrls', () => {
  const page = 'https://acme.eu/pricing/';

  it('finds what the browser loads and resolves relative paths', () => {
    const html = `
      <script src="/app.js"></script>
      <iframe src="https://www.youtube-nocookie.com/embed/x"></iframe>
      <img src="https://cdn.acme.eu/logo.png">
      <link rel="preconnect" href="https://fonts.gstatic.com">
      <link rel="modulepreload" href="/chunk.mjs">`;
    assert.deepEqual(resourceUrls(html, page), [
      { url: 'https://acme.eu/app.js', tag: 'script' },
      { url: 'https://www.youtube-nocookie.com/embed/x', tag: 'iframe' },
      { url: 'https://cdn.acme.eu/logo.png', tag: 'img' },
      { url: 'https://fonts.gstatic.com/', tag: 'link' },
      { url: 'https://acme.eu/chunk.mjs', tag: 'link' },
    ]);
  });

  it('skips plain links, canonical links, data URIs and duplicates', () => {
    const html = `
      <a href="https://twitter.com/acme">X</a>
      <link rel="canonical" href="https://acme.eu/">
      <img src="data:image/png;base64,AAAA">
      <script src="/a.js"></script><script src="/a.js"></script>`;
    assert.deepEqual(resourceUrls(html, page), [{ url: 'https://acme.eu/a.js', tag: 'script' }]);
  });
});

describe('cspHosts', () => {
  it('lists every host the policy allows, across directives and headers', () => {
    const hosts = cspHosts({
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com *.posthog.com; img-src data: blob: https:",
      'content-security-policy-report-only': 'connect-src wss://realtime.ably.io api.openai.com:443',
    });
    assert.deepEqual(hosts, [
      { host: 'js.stripe.com', wildcard: false },
      { host: 'posthog.com', wildcard: true },
      { host: 'realtime.ably.io', wildcard: false },
      { host: 'api.openai.com', wildcard: false },
    ]);
  });

  it('ignores report endpoints, keywords and IP addresses', () => {
    const hosts = cspHosts({
      'content-security-policy': "connect-src 'self' http://127.0.0.1:3000 localhost; report-uri https://reports.acme.eu/csp",
    });
    assert.deepEqual(hosts, []);
  });

  it('returns nothing when there is no policy', () => {
    assert.deepEqual(cspHosts({}), []);
  });
});

describe('hostnameCandidates', () => {
  it('finds API hosts written in source code', () => {
    const code = "const r = await fetch('https://api.openai.com/v1/chat');\nconst smtp = { host: 'smtp.sendgrid.net' };";
    const hosts = hostnameCandidates(code);
    assert.ok(hosts.has('api.openai.com'));
    assert.ok(hosts.has('smtp.sendgrid.net'));
  });

  it('ignores file names and property access', () => {
    const code = "import x from './index.ts'; user.name; config.data.value; require('lodash.merge.js')";
    assert.deepEqual([...hostnameCandidates(code)], []);
  });
});
