// Shared test utilities. Nothing here touches the public internet.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../bin/stackborder.js', import.meta.url));

/**
 * Creates a temporary folder from a { 'relative/path': contents } map.
 * Objects are written as JSON. Returns the folder path and a cleanup function.
 */
export async function makeRepo(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'stackborder-'));
  for (const [rel, contents] of Object.entries(files)) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Starts an HTTP server on a random local port. */
export async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/**
 * Runs the CLI as a user would and collects its output.
 * Color is off by default; pass `{ NO_COLOR: undefined, FORCE_COLOR: '1' }` to turn it on.
 */
export function runCli(args, { env = {}, cwd } = {}) {
  const merged = { ...process.env, NO_COLOR: '1', ...env };
  if (!('FORCE_COLOR' in env)) delete merged.FORCE_COLOR;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: merged });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Minimal vendor row for functions that only need a few fields. */
export function row(overrides) {
  return {
    id: 'acme',
    name: 'Acme',
    category: 'analytics',
    categoryLabel: 'Analytics',
    hq: 'US',
    country: 'United States',
    region: 'us',
    cloudAct: true,
    euRegion: false,
    euRegionInUse: false,
    confidence: 'confirmed',
    subprocessors: null,
    ai: null,
    evidence: [],
    alternatives: [],
    ...overrides,
  };
}
