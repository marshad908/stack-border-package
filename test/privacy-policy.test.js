import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findPolicyLinks, vendorsNamedIn } from '../src/privacy-policy.js';
import { buildReport } from '../src/report.js';

describe('findPolicyLinks', () => {
  it('finds privacy and subprocessor links by address or by text, in several languages', () => {
    const html = `
      <a href="/legal/privacy-policy">Privacy</a>
      <a href="/impressum">Impressum</a>
      <a href="https://acme.example/de/datenschutz#top">Datenschutzerklärung</a>
      <a href="/trust/list"><span>Sub-processors</span></a>
      <a href="mailto:privacy@acme.example">Email us</a>`;
    assert.deepEqual(findPolicyLinks(html, 'https://acme.example/'), {
      privacy: ['https://acme.example/legal/privacy-policy', 'https://acme.example/de/datenschutz'],
      subprocessors: ['https://acme.example/trust/list'],
    });
  });

  it('puts the policy itself before marketing pages that mention privacy', () => {
    const html = '<a href="/privacy-focused-web-analytics">Privacy-first analytics</a> <a href="/privacy">Privacy</a>';
    assert.deepEqual(findPolicyLinks(html, 'https://acme.example/').privacy, [
      'https://acme.example/privacy',
      'https://acme.example/privacy-focused-web-analytics',
    ]);
  });

  it('returns empty lists when the page links no policy', () => {
    assert.deepEqual(findPolicyLinks('<a href="/pricing">Pricing</a>', 'https://acme.example/'), { privacy: [], subprocessors: [] });
  });
});

describe('vendorsNamedIn', () => {
  it('finds vendors named by product', () => {
    const named = vendorsNamedIn('Payments are processed by Stripe. Emails are sent with Resend.');
    assert.ok(named.has('stripe'));
    assert.ok(named.has('resend'));
  });

  it('counts a vendor as named when the policy names its company', () => {
    const named = vendorsNamedIn('We use services from Google and host our servers with AWS.');
    assert.ok(named.has('google-analytics'));
    assert.ok(named.has('aws'));
  });

  it('ignores ordinary words that share a vendor name', () => {
    const named = vendorsNamedIn('We may resend the confirmation email. Our stripes are blue.');
    assert.ok(!named.has('resend'));
    assert.ok(!named.has('stripe'));
  });

  it('matches names that are written in lower case on purpose', () => {
    assert.ok(vendorsNamedIn('Our website is delivered through bunny.net.').has('bunny'));
    assert.ok(vendorsNamedIn('We use Bunny, a European CDN.').has('bunny'), 'without the domain ending');
    assert.ok(!vendorsNamedIn('A bunny ran across the road.').has('bunny'), 'but not the ordinary word');
  });

  it('ignores names glued to a longer word', () => {
    assert.ok(!vendorsNamedIn('See our Stripedesign partners.').has('stripe'));
  });
});

describe('privacy policy in the report', () => {
  const vendors = [
    { id: 'stripe', name: 'Stripe', category: 'payments', region: 'us' },
    { id: 'groq', name: 'Groq', category: 'ai', region: 'us' },
  ];

  it('lists detected vendors that a readable policy does not name', () => {
    const policy = { status: 'read', url: 'https://acme.example/privacy', subprocessorsUrl: null, namedVendorIds: ['stripe'] };
    const report = buildReport({ target: 'acme.example', kind: 'domain', vendors, privacyPolicy: policy });
    assert.deepEqual(report.privacyPolicy.notNamedVendorIds, ['groq']);
  });

  it('leaves out vendors only seen through a DNS verification token', () => {
    const withLikely = [...vendors, { id: 'zoom', name: 'Zoom', category: 'communications', region: 'us', confidence: 'likely' }];
    const policy = { status: 'read', url: 'https://acme.example/privacy', subprocessorsUrl: null, namedVendorIds: ['stripe'] };
    const report = buildReport({ target: 'acme.example', kind: 'domain', vendors: withLikely, privacyPolicy: policy });
    assert.deepEqual(report.privacyPolicy.notNamedVendorIds, ['groq']);
  });

  it('never claims omissions when the policy text could not be read', () => {
    const policy = { status: 'unreadable', url: 'https://acme.example/privacy', subprocessorsUrl: null, namedVendorIds: [] };
    const report = buildReport({ target: 'acme.example', kind: 'domain', vendors, privacyPolicy: policy });
    assert.deepEqual(report.privacyPolicy.notNamedVendorIds, []);
  });

  it('is null for a repository scan', () => {
    assert.equal(buildReport({ target: '.', kind: 'repo', vendors }).privacyPolicy, null);
  });
});
