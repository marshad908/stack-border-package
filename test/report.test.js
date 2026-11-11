import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, mergeVendorRows, suggestAiSystems, DISCLAIMER, RISK_TIERS } from '../src/index.js';
import { row } from './helpers.js';

describe('buildReport', () => {
  it('produces the documented shape', () => {
    const report = buildReport({ target: 'acme.eu', kind: 'domain', vendors: [row({ category: 'hosting' })] });
    assert.equal(report.target, 'acme.eu');
    assert.equal(report.kind, 'domain');
    assert.ok(!Number.isNaN(Date.parse(report.scannedAt)));
    assert.match(report.databaseVersion, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(report.score.total, 1);
    assert.deepEqual(report.notes, []);
    assert.deepEqual(report.meta, {});
    assert.equal(report.disclaimer, DISCLAIMER);
  });

  it('is JSON round-trippable', () => {
    const report = buildReport({ target: 'acme.eu', kind: 'domain', vendors: [row({})] });
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  });
});

describe('mergeVendorRows', () => {
  it('combines evidence without duplicates', () => {
    const fromSite = row({ evidence: [{ source: 'Page resource', value: 'https://js.acme.com' }] });
    const fromCode = row({ evidence: [{ source: 'npm package', value: 'acme' }, { source: 'Page resource', value: 'https://js.acme.com' }] });
    const [merged] = mergeVendorRows([fromSite], [fromCode]);
    assert.deepEqual(merged.evidence.map((e) => e.source), ['Page resource', 'npm package']);
  });

  it('lets one confirmed finding outweigh a "likely" one', () => {
    const [merged] = mergeVendorRows([row({ confidence: 'likely' })], [row({ confidence: 'confirmed' })]);
    assert.equal(merged.confidence, 'confirmed');
  });

  it('keeps "EU region in use" when any source saw it', () => {
    const [merged] = mergeVendorRows([row({ euRegionInUse: true })], [row({ euRegionInUse: false })]);
    assert.equal(merged.euRegionInUse, true);
  });

  it('does not modify its input', () => {
    const input = row({ evidence: [{ source: 'a', value: '1' }] });
    mergeVendorRows([input], [row({ evidence: [{ source: 'b', value: '2' }] })]);
    assert.equal(input.evidence.length, 1);
  });

  it('sorts the riskiest jurisdictions first', () => {
    const merged = mergeVendorRows([row({ id: 'eu-co', name: 'EU Co', region: 'eu' })], [row({ id: 'us-co', name: 'US Co', region: 'us' })]);
    assert.deepEqual(merged.map((r) => r.id), ['us-co', 'eu-co']);
  });
});

describe('suggestAiSystems', () => {
  it('suggests an inventory entry for each AI vendor', () => {
    const suggestions = suggestAiSystems([
      row({ id: 'openai', name: 'OpenAI', category: 'ai', ai: { generative: true } }),
      row({ id: 'pinecone', name: 'Pinecone', category: 'ai', ai: { generative: false } }),
      row({ id: 'stripe', name: 'Stripe', category: 'payments' }),
    ]);
    assert.deepEqual(suggestions.map((s) => [s.vendorId, s.suggestedTier]), [['openai', 'limited'], ['pinecone', 'minimal']]);
    for (const s of suggestions) assert.ok(Object.hasOwn(RISK_TIERS, s.suggestedTier));
  });
});
