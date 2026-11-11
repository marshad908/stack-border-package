// Scans real websites over the internet. Not part of `npm test` because the
// result depends on the network and on third-party sites; run with `npm run test:live`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanDomain, FetchError } from '../../src/index.js';

describe('live domain scans', { timeout: 60_000 }, () => {
  it('scans a real site end to end and reports progress', async () => {
    const steps = [];
    const report = await scanDomain('plausible.io', { onProgress: (s) => steps.push(`${s.id}:${s.status}`) });
    assert.equal(report.target, 'plausible.io');
    assert.equal(report.kind, 'domain');
    assert.ok(report.vendors.length > 0, 'found vendors');
    assert.equal(typeof report.score.score, 'number');
    assert.ok(Array.isArray(report.meta.dns.mx));
    assert.ok(steps.includes('dns:done') && steps.includes('match:done'), steps.join(' '));
  });

  it('refuses a public name that points into a private network', async () => {
    await assert.rejects(scanDomain('127.0.0.1.nip.io'), (err) => err instanceof FetchError && err.code === 'PRIVATE');
  });

  it('explains when a domain does not exist', async () => {
    await assert.rejects(scanDomain('this-domain-should-not-exist-stackborder.eu'), { code: 'DNS' });
  });
});
