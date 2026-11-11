// End-to-end tests: run the real executable the way a user would.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
import { makeRepo, runCli, startServer } from './helpers.js';

let usStack;
let euStack;
before(async () => {
  usStack = await makeRepo({ 'package.json': { dependencies: { stripe: '1', '@sentry/nextjs': '1', openai: '1' } }, 'vercel.json': '{}' });
  euStack = await makeRepo({ 'package.json': { dependencies: { '@mistralai/mistralai': '1' } } });
});
after(() => Promise.all([usStack.cleanup(), euStack.cleanup()]));

describe('cli: help and version', () => {
  it('--version prints the package version', async () => {
    for (const flag of ['--version', '-v']) {
      const { code, stdout } = await runCli([flag]);
      assert.equal(code, 0);
      assert.equal(stdout.trim(), pkg.version);
    }
  });

  it('--help prints usage and exits 0', async () => {
    const { code, stdout } = await runCli(['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /Usage/);
    assert.match(stdout, /--fail-under/);
  });

  it('prints usage and exits 1 when run without arguments', async () => {
    const { code, stdout } = await runCli([]);
    assert.equal(code, 1);
    assert.match(stdout, /Usage/);
  });
});

describe('cli: input validation', () => {
  const cases = [
    ['an unknown option', ['--nope'], /Unknown option '--nope'/],
    ['two domains', ['a.eu', 'b.eu'], /Expected one domain/],
    ['a non-numeric threshold', ['--repo', '.', '--fail-under', 'abc'], /whole number from 0 to 100/],
    ['a threshold above 100', ['--repo', '.', '--fail-under', '101'], /whole number from 0 to 100/],
    ['--upload without --token', ['--repo', '.', '--upload', 'https://app.example.eu'], /requires --token/],
    ['--token without --upload', ['--repo', '.', '--token', 'etk_x'], /only used together with --upload/],
    ['an upload URL over plain HTTP', ['--repo', '.', '--upload', 'http://app.example.eu', '--token', 't'], /must use https/],
    ['an upload value that is not a URL', ['--repo', '.', '--upload', 'not a url', '--token', 't'], /expects a URL/],
    ['an invalid domain', ['not a domain'], /"not a domain" is not a valid/],
    ['a missing repo folder', ['--repo', './does-not-exist-anywhere'], /is not a folder/],
    // Local addresses point to --repo, so a project that is not online yet can still be scanned.
    ['localhost with a port', ['localhost:3000'], /"localhost:3000" is not a public domain[\s\S]*npx stackborder --repo \./],
    ['a local URL', ['http://127.0.0.1:8080/app'], /is not a public domain[\s\S]*--repo \./],
    ['a private network address', ['192.168.1.20'], /is not a public domain[\s\S]*--repo \./],
    ['a .local name', ['myapp.local'], /is not a public domain[\s\S]*--repo \./],
    ['a single name', ['myapp'], /is not a public domain[\s\S]*--repo \./],
    ['a local address together with --repo', ['localhost', '--repo', 'src'], /Leave out the domain[\s\S]*--repo src/],
  ];
  for (const [label, args, message] of cases) {
    it(`rejects ${label} with exit code 1`, async () => {
      const { code, stderr, stdout } = await runCli(args);
      assert.equal(code, 1);
      assert.match(stderr, message);
      assert.equal(stdout, '', 'nothing on stdout, so piping to a file stays clean');
    });
  }
});

describe('cli: scanning a repository', () => {
  it('prints a readable report', async () => {
    const { code, stdout } = await runCli(['--repo', usStack.root]);
    assert.equal(code, 0);
    assert.match(stdout, /Sovereignty score \d+\/100 \([A-E]\)/);
    for (const name of ['Stripe', 'Sentry', 'OpenAI', 'Vercel']) assert.match(stdout, new RegExp(name));
    assert.match(stdout, /EU options:/);
    assert.match(stdout, /AI Act inventory/);
    assert.match(stdout, /not legal advice/);
  });

  it('prints valid JSON with --json and nothing else on stdout', async () => {
    const { code, stdout } = await runCli(['--repo', usStack.root, '--json']);
    assert.equal(code, 0);
    const report = JSON.parse(stdout);
    assert.equal(report.kind, 'repo');
    assert.ok(report.vendors.some((v) => v.id === 'stripe'));
    assert.equal(typeof report.score.score, 'number');
  });

  it('uses no color codes when NO_COLOR is set', async () => {
    const { stdout } = await runCli(['--repo', usStack.root]);
    assert.doesNotMatch(stdout, /\x1b\[/);
  });

  it('uses color when FORCE_COLOR is set', async () => {
    const { stdout } = await runCli(['--repo', usStack.root], { env: { NO_COLOR: undefined, FORCE_COLOR: '1' } });
    assert.match(stdout, /\x1b\[/);
  });

  it('exits 2 when the score is below --fail-under', async () => {
    const { code, stderr } = await runCli(['--repo', usStack.root, '--fail-under', '90']);
    assert.equal(code, 2);
    assert.match(stderr, /below the required 90/);
  });

  it('exits 0 when the score meets --fail-under', async () => {
    const { code } = await runCli(['--repo', euStack.root, '--fail-under', '90']);
    assert.equal(code, 0);
  });

  it('does not fail CI when no vendors are found', async () => {
    const empty = await makeRepo({ 'README.md': '# empty' });
    try {
      const { code, stdout } = await runCli(['--repo', empty.root, '--fail-under', '50']);
      assert.equal(code, 0);
      assert.match(stdout, /No third-party vendors detected/);
    } finally {
      await empty.cleanup();
    }
  });
});

describe('cli: --upload', () => {
  let server;
  let received;
  before(async () => {
    server = await startServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received = { method: req.method, path: req.url, auth: req.headers.authorization, body };
        const ok = req.headers.authorization === 'Bearer good-token';
        res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
        res.end(JSON.stringify(ok ? { added: 3, updated: 1 } : { error: 'Invalid token' }));
      });
    });
  });
  after(() => server.close());

  it('sends the report with the token to /api/ingest', async () => {
    const { code, stderr } = await runCli(['--repo', usStack.root, '--upload', server.url.replace('127.0.0.1', 'localhost'), '--token', 'good-token']);
    assert.equal(code, 0, stderr);
    assert.equal(received.method, 'POST');
    assert.equal(received.path, '/api/ingest');
    assert.equal(received.auth, 'Bearer good-token');
    assert.equal(JSON.parse(received.body).kind, 'repo');
    assert.match(stderr, /Uploaded: 3 new, 1 updated/);
  });

  it('reports a rejected upload and exits 1', async () => {
    const { code, stderr } = await runCli(['--repo', usStack.root, '--upload', server.url, '--token', 'bad-token']);
    assert.equal(code, 1);
    assert.match(stderr, /Upload rejected \(HTTP 401\): Invalid token/);
  });

  it('reports an unreachable server and exits 1', async () => {
    const { code, stderr } = await runCli(['--repo', usStack.root, '--upload', 'http://127.0.0.1:1', '--token', 't']);
    assert.equal(code, 1);
    assert.match(stderr, /Upload to http:\/\/127\.0\.0\.1:1 failed/);
  });
});
