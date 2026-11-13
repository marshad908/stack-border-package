// Guards the quality of the bundled vendor database: a bad entry here
// becomes a wrong finding in every user's report.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listVendors, getVendor, loadVendorDb, alternativesFor, categoryLabel, CATEGORY_LABELS } from '../src/index.js';

const DETECT_KEYS = new Set(['ns', 'mx', 'spf', 'txt', 'cname', 'ptr', 'header', 'script', 'html', 'npm', 'pypi', 'composer', 'wpPlugin', 'shopifyApp', 'env', 'host']);
const vendors = listVendors();

describe('vendor database', () => {
  it('has a dated version and a useful number of vendors', () => {
    assert.match(loadVendorDb().version, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(vendors.length >= 150, `${vendors.length} vendors`);
  });

  it('uses unique, url-safe ids', () => {
    const ids = vendors.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
    for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
  });

  for (const v of vendors) {
    it(`${v.id} is well formed`, () => {
      assert.ok(v.name.trim(), 'name');
      assert.match(v.hq, /^[A-Z]{2}$/, 'hq is an ISO country code');
      assert.ok(Object.hasOwn(CATEGORY_LABELS, v.category), `unknown category "${v.category}"`);
      if (v.subprocessors) assert.match(v.subprocessors, /^https:\/\/[^\s]+$/, 'subprocessor page uses https');

      const rules = Object.entries(v.detect || {});
      assert.ok(rules.length > 0, 'has at least one detection rule');
      for (const [key, patterns] of rules) {
        assert.ok(DETECT_KEYS.has(key), `unknown detection key "${key}"`);
        assert.ok(Array.isArray(patterns) && patterns.length > 0, `${key} has patterns`);
        for (const p of patterns) assert.ok(typeof p === 'string' && p.trim().length >= 3, `${key} pattern "${p}" is too short to be safe`);
      }
      if (v.euSignals) assert.ok(v.euSignals.every((s) => typeof s === 'string' && s.length > 3), 'euSignals');
      if (v.category === 'ai') assert.equal(typeof v.ai?.generative, 'boolean', 'AI vendors say whether they are generative');
    });
  }
});

describe('vendor lookups', () => {
  it('finds vendors by id', () => {
    assert.equal(getVendor('hetzner').name, 'Hetzner');
    assert.equal(getVendor('hetzner').region, 'eu');
    assert.equal(getVendor('nope'), null);
  });

  it('suggests only European alternatives, and none for EU vendors', () => {
    const options = alternativesFor('google-analytics');
    assert.ok(options.length > 0 && options.length <= 3);
    for (const o of options) assert.ok(['eu', 'eea', 'adequate'].includes(o.region), o.id);
    assert.deepEqual(alternativesFor('plausible'), []);
    assert.deepEqual(alternativesFor('nope'), []);
  });

  it('labels categories for humans', () => {
    assert.equal(categoryLabel('cdn'), 'CDN and edge');
    assert.equal(categoryLabel('brand-new'), 'brand-new');
  });
});
