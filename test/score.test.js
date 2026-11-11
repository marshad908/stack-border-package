import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, jurisdictionFactor, categoryWeight, gradeFor, regionOf, countryName, cloudActExposed } from '../src/index.js';

describe('computeScore', () => {
  it('returns null for a stack without vendors', () => {
    assert.deepEqual(computeScore([]), { score: null, grade: null, eu: 0, nonEu: 0, cloudAct: 0, total: 0 });
  });

  it('gives an all-EU stack 100 (A)', () => {
    const result = computeScore([{ category: 'hosting', region: 'eu' }, { category: 'analytics', region: 'eea' }]);
    assert.equal(result.score, 100);
    assert.equal(result.grade, 'A');
    assert.equal(result.eu, 2);
    assert.equal(result.nonEu, 0);
  });

  it('weights critical categories more than minor ones', () => {
    const usHosting = computeScore([{ category: 'hosting', region: 'us' }, { category: 'fonts', region: 'eu' }]);
    const usFonts = computeScore([{ category: 'hosting', region: 'eu' }, { category: 'fonts', region: 'us' }]);
    assert.ok(usHosting.score < usFonts.score, `${usHosting.score} < ${usFonts.score}`);
  });

  it('counts vendors exposed to the US CLOUD Act', () => {
    const result = computeScore([{ category: 'hosting', region: 'us' }, { category: 'crm', region: 'us' }, { category: 'cdn', region: 'eu' }]);
    assert.equal(result.cloudAct, 2);
    assert.equal(result.total, 3);
  });

  it('matches the published formula', () => {
    // hosting (3) in the US with EU region in use: 3 * 0.4 = 1.2; analytics (2) in the EU: 2 * 1 = 2
    const result = computeScore([{ category: 'hosting', region: 'us', euRegionInUse: true }, { category: 'analytics', region: 'eu' }]);
    assert.equal(result.score, Math.round((1.2 + 2) / 5 * 100));
  });
});

describe('jurisdictionFactor', () => {
  it('ranks jurisdictions from safest to riskiest', () => {
    assert.equal(jurisdictionFactor({ region: 'eu' }), 1);
    assert.equal(jurisdictionFactor({ region: 'eea' }), 1);
    assert.equal(jurisdictionFactor({ region: 'adequate' }), 0.75);
    assert.equal(jurisdictionFactor({ region: 'us', euRegionInUse: true }), 0.4);
    assert.equal(jurisdictionFactor({ region: 'us', euRegion: true }), 0.3);
    assert.equal(jurisdictionFactor({ region: 'us' }), 0.2);
    assert.equal(jurisdictionFactor({ region: 'other' }), 0.3);
    assert.equal(jurisdictionFactor({ region: 'unknown' }), 0.5);
  });
});

describe('categoryWeight and gradeFor', () => {
  it('uses weight 1 for unknown categories', () => {
    assert.equal(categoryWeight('hosting'), 3);
    assert.equal(categoryWeight('something-new'), 1);
  });

  it('grades on fixed boundaries', () => {
    const expected = [[100, 'A'], [85, 'A'], [84, 'B'], [70, 'B'], [69, 'C'], [50, 'C'], [49, 'D'], [30, 'D'], [29, 'E'], [0, 'E']];
    for (const [score, grade] of expected) assert.equal(gradeFor(score), grade, `score ${score}`);
  });
});

describe('jurisdiction', () => {
  it('groups countries by GDPR transfer rules', () => {
    assert.equal(regionOf('DE'), 'eu');
    assert.equal(regionOf('de'), 'eu');
    assert.equal(regionOf('NO'), 'eea');
    assert.equal(regionOf('GB'), 'adequate');
    assert.equal(regionOf('CH'), 'adequate');
    assert.equal(regionOf('US'), 'us');
    assert.equal(regionOf('IN'), 'other');
    assert.equal(regionOf(''), 'unknown');
    assert.equal(regionOf(undefined), 'unknown');
  });

  it('names countries and flags CLOUD Act exposure', () => {
    assert.equal(countryName('FR'), 'France');
    assert.equal(countryName('ZZ'), 'ZZ');
    assert.equal(countryName(''), 'Unknown');
    assert.equal(cloudActExposed('us'), true);
    assert.equal(cloudActExposed('DE'), false);
  });
});
