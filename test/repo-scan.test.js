import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { scanRepo } from '../src/index.js';
import { makeRepo } from './helpers.js';

const cleanups = [];
after(() => Promise.all(cleanups.map((fn) => fn())));

async function scan(files) {
  const repo = await makeRepo(files);
  cleanups.push(repo.cleanup);
  return scanRepo(repo.root);
}
const ids = (report) => report.vendors.map((v) => v.id).sort();

describe('scanRepo', () => {
  it('reads npm dependencies of every kind', async () => {
    const report = await scan({
      'package.json': {
        dependencies: { stripe: '^14' },
        devDependencies: { '@sentry/cli': '^2' },
        optionalDependencies: { openai: '^4' },
      },
    });
    assert.deepEqual(ids(report), ['openai', 'sentry', 'stripe']);
    assert.equal(report.kind, 'repo');
    assert.deepEqual(report.meta.manifests, ['package.json']);
  });

  it('reads requirements files, ignoring comments, options and version pins', async () => {
    const report = await scan({
      'requirements.txt': '# deps\n-r base.txt\nsentry-sdk[flask]==2.0 ; python_version > "3.8"\nboto3>=1\n',
      'requirements-dev.txt': 'stripe~=8.0\n',
    });
    assert.deepEqual(ids(report), ['aws', 'sentry', 'stripe']);
  });

  it('reads pyproject.toml in PEP 621 and Poetry style', async () => {
    const pep621 = await scan({ 'pyproject.toml': '[project]\ndependencies = ["stripe>=8", "openai"]\n' });
    assert.deepEqual(ids(pep621), ['openai', 'stripe']);
    const poetry = await scan({ 'pyproject.toml': '[tool.poetry.dependencies]\npython = "^3.12"\nsentry-sdk = "^2"\n\n[build-system]\nrequires = []\n' });
    assert.deepEqual(ids(poetry), ['sentry']);
  });

  it('reads only the dependency tables of a Pipfile', async () => {
    const report = await scan({
      Pipfile: '[[source]]\nurl = "https://pypi.org/simple"\nname = "pypi"\n\n[packages]\nstripe = "*"\n\n[dev-packages]\nsentry-sdk = "*"\n\n[requires]\npython_version = "3.12"\n',
    });
    assert.deepEqual(ids(report), ['sentry', 'stripe']);
    assert.equal(report.meta.packages, 2);
  });

  it('detects the hosting platform from deploy configs', async () => {
    const report = await scan({ 'vercel.json': '{}', 'infra/fly.toml': 'app = "x"' });
    const vercel = report.vendors.find((v) => v.id === 'vercel');
    assert.deepEqual(vercel.evidence, [{ source: 'Deploy config', value: 'vercel.json' }]);
    assert.ok(ids(report).includes('flyio'));
  });

  it('adds deploy-config evidence to a vendor already found in dependencies', async () => {
    const report = await scan({ 'package.json': { dependencies: { '@vercel/analytics': '1' } }, 'vercel.json': '{}' });
    const vercel = report.vendors.find((v) => v.id === 'vercel');
    assert.ok(vercel.evidence.some((e) => e.source === 'Deploy config'));
  });

  it('scans nested packages in a monorepo', async () => {
    const report = await scan({ 'apps/web/package.json': { dependencies: { stripe: '1' } }, 'services/api/requirements.txt': 'openai\n' });
    assert.deepEqual(ids(report), ['openai', 'stripe']);
  });

  it('skips node_modules, hidden folders and build output', async () => {
    const report = await scan({
      'node_modules/x/package.json': { dependencies: { stripe: '1' } },
      '.git/package.json': { dependencies: { stripe: '1' } },
      'dist/package.json': { dependencies: { stripe: '1' } },
    });
    assert.deepEqual(ids(report), []);
    assert.equal(report.score.score, null);
  });

  it('survives broken manifests', async () => {
    const report = await scan({ 'package.json': '{ not json', 'requirements.txt': 'stripe\n' });
    assert.deepEqual(ids(report), ['stripe']);
  });

  it('does not treat files named like Object methods as deploy configs', async () => {
    const report = await scan({ constructor: 'x', toString: 'y', hasOwnProperty: 'z' });
    assert.deepEqual(ids(report), []);
  });

  it('suggests AI Act inventory entries for AI SDKs', async () => {
    const report = await scan({ 'package.json': { dependencies: { '@anthropic-ai/sdk': '1' } } });
    assert.equal(report.aiSystems.length, 1);
    assert.equal(report.aiSystems[0].vendorId, 'anthropic');
    assert.equal(report.aiSystems[0].suggestedTier, 'limited');
  });

  it('rejects a path that is not a folder', async () => {
    await assert.rejects(scanRepo('/definitely/not/here'), /is not a folder/);
  });
});
