import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { containsToken, detectVendors, toVendorRows } from '../src/index.js';

describe('containsToken', () => {
  it('matches whole labels, case-insensitively', () => {
    assert.equal(containsToken('aspmx.l.google.com', 'google.com'), true);
    assert.equal(containsToken('ASPMX.L.GOOGLE.COM', 'google.com'), true);
    assert.equal(containsToken('google.com', 'google.com'), true);
  });

  it('does not match a needle glued to a longer label', () => {
    assert.equal(containsToken('fiscal.com/app', 'cal.com/'), false);
    assert.equal(containsToken('notgoogle.com', 'google.com'), false);
    assert.equal(containsToken('my-google.com', 'google.com'), false);
  });

  it('finds a later valid occurrence after an invalid one', () => {
    assert.equal(containsToken('fiscal.com https://cal.com/x', 'cal.com/'), true);
  });

  it('treats needles starting with a dot or slash as already anchored', () => {
    assert.equal(containsToken('abc.supabase.co', '.supabase.co'), true);
  });

  it('never matches an empty needle', () => {
    assert.equal(containsToken('anything', ''), false);
  });
});

describe('detectVendors', () => {
  it('detects vendors from every kind of signal', () => {
    const found = detectVendors({
      mx: ['aspmx.l.google.com'],
      spf: ['v=spf1 include:_spf.google.com include:sendgrid.net ~all'],
      ns: ['ada.ns.cloudflare.com'],
      headers: { 'cf-ray': '8abc-FRA', server: 'cloudflare' },
      urls: ['https://js.stripe.com/v3/', 'https://eu.i.posthog.com/static/array.js'],
      npm: ['@sentry/nextjs', 'openai', '@mistralai/mistralai'],
      pypi: [],
    });
    for (const id of ['google-workspace', 'sendgrid', 'cloudflare', 'stripe', 'posthog', 'sentry', 'openai', 'mistral']) {
      assert.ok(found.has(id), `${id} detected`);
    }
    assert.equal(found.has('microsoft-365'), false);
  });

  it('records where each vendor was seen', () => {
    const found = detectVendors({ npm: ['stripe'] });
    assert.deepEqual(found.get('stripe'), [{ source: 'npm package', value: 'stripe' }]);
  });

  it('returns nothing for empty input', () => {
    assert.equal(detectVendors({}).size, 0);
  });

  it('keeps at most six pieces of evidence per vendor', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://js.stripe.com/v${i}/`);
    const evidence = detectVendors({ urls, npm: ['stripe', '@stripe/stripe-js'] }).get('stripe');
    assert.ok(evidence.length <= 6);
  });

  it('prefers a specific product over its parent platform', () => {
    const found = detectVendors({ npm: ['@aws-sdk/client-ses'] });
    assert.ok(found.has('amazon-ses'));
    assert.equal(found.has('aws'), false);
  });
});

describe('toVendorRows', () => {
  it('builds report rows with jurisdiction data and EU alternatives', () => {
    const [rowFound] = toVendorRows(new Map([['google-analytics', [{ source: 'Page resource', value: 'https://www.googletagmanager.com/gtag/js' }]]]));
    assert.equal(rowFound.region, 'us');
    assert.equal(rowFound.cloudAct, true);
    assert.equal(rowFound.confidence, 'confirmed');
    assert.ok(rowFound.alternatives.length > 0);
    assert.ok(rowFound.alternatives.every((a) => ['eu', 'eea', 'adequate'].includes(a.region)));
  });

  it('marks a vendor seen only in a DNS TXT record as "likely"', () => {
    const [rowFound] = toVendorRows(new Map([['stripe', [{ source: 'DNS TXT', value: 'stripe-verification=abc' }]]]));
    assert.equal(rowFound.confidence, 'likely');
  });

  it('notices when the EU data region of a US vendor is in use', () => {
    const [rowFound] = toVendorRows(new Map([['posthog', [{ source: 'Page resource', value: 'https://eu.i.posthog.com/static/array.js' }]]]));
    assert.equal(rowFound.euRegionInUse, true);
  });

  it('skips ids that are not in the database', () => {
    assert.deepEqual(toVendorRows(new Map([['does-not-exist', []]])), []);
  });

  it('sorts the riskiest jurisdictions first', () => {
    const rows = toVendorRows(new Map([['hetzner', []], ['stripe', []], ['plausible', []]]));
    assert.equal(rows[0].id, 'stripe');
  });
});
