// Tests for the "never miss silently" features: extra signal sources,
// unrecognized domains, anti-bot detection and coverage reporting.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectVendors, unrecognizedDomains, looksBlocked, scanRepo, buildReport, toVendorRows } from '../src/index.js';
import { makeRepo, runCli } from './helpers.js';

const ids = (found) => [...found.keys()].sort();

describe('detectVendors with hosts and env keys', () => {
  it('matches exact hosts from a CSP or source code', () => {
    const found = detectVendors({
      hosts: [
        { host: 'api.openai.com', source: 'Source code', where: 'src/ai.ts' },
        { host: 'js.stripe.com', source: 'CSP header' },
      ],
    });
    assert.deepEqual(ids(found), ['openai', 'stripe']);
    assert.deepEqual(found.get('openai'), [{ source: 'Source code', value: 'src/ai.ts: api.openai.com' }]);
  });

  it('credits a CSP wildcard to the single vendor that owns the domain', () => {
    const found = detectVendors({ hosts: [{ host: 'stripe.com', wildcard: true, source: 'CSP header' }] });
    assert.deepEqual(found.get('stripe'), [{ source: 'CSP header', value: '*.stripe.com' }]);
  });

  it('does not credit wildcards on platforms shared by many products', () => {
    const found = detectVendors({ hosts: [{ host: 'googleapis.com', wildcard: true, source: 'CSP header' }] });
    assert.equal(found.size, 0);
  });

  it('does not treat a link in page text as a host-only match', () => {
    // youtube.com is a host pattern: it must come from a load, not from a footer link.
    const found = detectVendors({ html: '<a href="https://youtube.com/@acme">Our channel</a>' });
    assert.ok(!found.has('youtube'));
  });

  it('maps env variable names, including framework public prefixes', () => {
    const found = detectVendors({
      envKeys: [
        { key: 'STRIPE_SECRET_KEY', file: '.env.example' },
        { key: 'NEXT_PUBLIC_POSTHOG_KEY', file: '.env.example' },
        { key: 'HF_TOKEN', file: 'api/.env.sample' },
      ],
    });
    assert.deepEqual(ids(found), ['huggingface', 'posthog', 'stripe']);
    assert.deepEqual(found.get('posthog'), [{ source: 'Env example', value: '.env.example: NEXT_PUBLIC_POSTHOG_KEY' }]);
  });

  it('needs the whole name for exact env patterns', () => {
    const found = detectVendors({ envKeys: [{ key: 'HF_TOKEN_EXTRA', file: '.env.example' }] });
    assert.ok(!found.has('huggingface'));
  });
});

describe('confidence of weak evidence', () => {
  it('marks vendors seen only in a CSP as likely, not confirmed', () => {
    const [stripe] = toVendorRows(new Map([['stripe', [{ source: 'CSP header', value: 'js.stripe.com' }]]]));
    assert.equal(stripe.confidence, 'likely');
  });

  it('confirms them once a stronger source agrees', () => {
    const [stripe] = toVendorRows(
      new Map([['stripe', [{ source: 'CSP header', value: 'js.stripe.com' }, { source: 'npm package', value: 'stripe' }]]]),
    );
    assert.equal(stripe.confidence, 'confirmed');
  });
});

describe('unrecognizedDomains', () => {
  const isOwn = (host) => host.endsWith('acme.eu');

  it('lists third-party domains the database does not know, grouped by domain', () => {
    const list = unrecognizedDomains(
      [
        { host: 'cdn.acme.eu', source: 'Page resource' },
        { host: 'js.stripe.com', source: 'Page resource' },
        { host: 'a.tinyvendor.io', source: 'CSP header' },
        { host: 'b.tinyvendor.io', source: 'Page resource' },
        { host: 'www.w3.org', source: 'Page resource' },
      ],
      isOwn,
      new Map(),
    );
    assert.deepEqual(list, [{ domain: 'tinyvendor.io', hosts: ['a.tinyvendor.io', 'b.tinyvendor.io'], source: 'CSP header' }]);
  });

  it('still lists apps hosted on shared platforms, since we cannot tell who runs them', () => {
    const list = unrecognizedDomains([{ host: 'some-app.vercel.app', source: 'CSP header' }], isOwn, new Map());
    assert.equal(list[0]?.domain, 'vercel.app');
  });

  it('leaves out hosts already explained by a finding', () => {
    const detected = new Map([['custom', [{ source: 'CSP header', value: 'widget.tinyvendor.io' }]]]);
    assert.deepEqual(unrecognizedDomains([{ host: 'widget.tinyvendor.io', source: 'CSP header' }], isOwn, detected), []);
  });
});

describe('looksBlocked', () => {
  const res = (status, body = '', headers = {}) => ({ status, body, headers });

  it('recognises common anti-bot challenges', () => {
    assert.ok(looksBlocked(res(403, '<title>Just a moment...</title>')));
    assert.ok(looksBlocked(res(503, '<div id="px-captcha">')));
    assert.ok(looksBlocked(res(200, '', { 'cf-mitigated': 'challenge' })));
  });

  it('does not flag normal pages or plain errors', () => {
    assert.ok(!looksBlocked(res(200, 'Fill in the captcha below to subscribe')));
    assert.ok(!looksBlocked(res(404, 'Not found')));
    assert.ok(!looksBlocked(res(503, 'Service unavailable')));
  });
});

describe('scanRepo source code and env templates', () => {
  it('finds server-side vendors that have no package, and reports what it read', async (t) => {
    const repo = await makeRepo({
      'package.json': { dependencies: { next: '16.0.0' } },
      'src/mail.ts': "await fetch('https://api.resend.com/emails', { method: 'POST' });",
      'src/ai.py': 'client = httpx.post("https://api.mistral.ai/v1/chat/completions")',
      '.env.example': 'TWILIO_AUTH_TOKEN=\nexport SENTRY_DSN=https://example\nAPP_URL=http://localhost:3000\n',
    });
    t.after(repo.cleanup);

    const report = await scanRepo(repo.root);
    assert.deepEqual(report.vendors.map((v) => v.id).sort(), ['mistral', 'resend', 'sentry', 'twilio']);
    assert.deepEqual(report.coverage, { repo: { manifests: 1, sourceFiles: 2, envFiles: 1, wordpressPlugins: 0, shopifyApps: 0, truncated: false } });
  });

  it('never reads real .env files', async (t) => {
    const repo = await makeRepo({ '.env': 'STRIPE_SECRET_KEY=sk_live_123', '.env.local': 'OPENAI_API_KEY=sk-1' });
    t.after(repo.cleanup);
    const report = await scanRepo(repo.root);
    assert.deepEqual(report.vendors, []);
    assert.equal(report.coverage.repo.envFiles, 0);
  });

  it('skips dependencies, build output and minified bundles', async (t) => {
    const repo = await makeRepo({
      'node_modules/openai/index.js': "const BASE = 'https://api.openai.com/v1';",
      'dist/app.js': "fetch('https://api.openai.com/v1')",
      'public/vendor.min.js': "fetch('https://api.openai.com/v1')",
      'src/types.d.ts': "// see https://api.openai.com",
    });
    t.after(repo.cleanup);
    const report = await scanRepo(repo.root);
    assert.deepEqual(report.vendors, []);
  });
});

describe('report coverage fields', () => {
  it('always carries coverage and unrecognized lists', () => {
    const report = buildReport({ target: 'acme.eu', kind: 'domain', vendors: [] });
    assert.deepEqual(report.coverage, {});
    assert.deepEqual(report.unrecognized, []);
  });
});

describe('CLI coverage line', () => {
  it('tells the reader what was checked in a repo scan', async (t) => {
    const repo = await makeRepo({ 'package.json': { dependencies: { stripe: '1.0.0' } }, 'src/a.js': 'export {}' });
    t.after(repo.cleanup);
    const { code, stdout } = await runCli(['--repo', repo.root]);
    assert.equal(code, 0);
    assert.match(stdout, /Checked: 1 manifest, 1 source file, 0 \.env templates/);
  });
});
