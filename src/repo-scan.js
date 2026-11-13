// Reads a local repository: dependency manifests, deploy configs, API hosts
// written in source code, and variable names in .env.example files.
// Everything stays on the machine unless the user passes --upload.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { extractUrls, hostnameCandidates } from './hosts.js';

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', 'obj', 'venv', '__pycache__',
  'storybook-static', 'bower_components', 'jspm_packages',
]);
const MAX_DEPTH = 8;
const MAX_SOURCE_URLS = 5000;
const MAX_FILES = 20_000;

const MAX_SOURCE_FILES = 4000;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 40 * 1024 * 1024;

const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.php', '.java', '.kt', '.kts', '.cs', '.rs', '.ex', '.exs', '.swift', '.dart', '.scala',
  '.yaml', '.yml', '.toml', '.tf', '.hcl', '.ini', '.conf', '.properties',
  // Templates: Shopify themes (Liquid), WordPress and Symfony (Twig), static sites and other theme systems.
  '.liquid', '.html', '.htm', '.twig', '.hbs', '.handlebars', '.njk', '.erb', '.ejs',
]);

// Shopify theme JSON (templates, sections, settings) names the apps embedded in the theme.
const SHOPIFY_THEME_JSON = /(^|\/)(templates|sections|config|blocks)\/[^/]+\.json$/;
const SHOPIFY_APP_REF = /shopify:\/\/apps\/([a-z0-9][a-z0-9-]*)\//g;

// WordPress core ships with every install and says nothing about the site's own vendors.
const WORDPRESS_CORE = new Set(['wp-admin', 'wp-includes']);
const GENERATED_FILE = /\.(min|bundle|chunk)\.[a-z]+$|\.d\.ts$|(^|[\\/])(package-lock|yarn|pnpm-lock|composer\.lock)/i;

// Template env files document which services an app needs. Real .env files hold secrets and are never read.
const ENV_TEMPLATE = /^(\.env\.(example|sample|template|dist|defaults)|\.env\.[a-z]+\.example|example\.env|env\.example|sample\.env)$/i;

// Config files that show where the app is deployed.
const CONFIG_FILES = {
  'vercel.json': 'vercel',
  'netlify.toml': 'netlify',
  'fly.toml': 'flyio',
  'render.yaml': 'render',
  'railway.json': 'railway',
  'railway.toml': 'railway',
  'wrangler.toml': 'cloudflare',
  'wrangler.jsonc': 'cloudflare',
  'app.yaml': 'gcp',
  'firebase.json': 'firebase',
  'serverless.yml': 'aws',
  'amplify.yml': 'aws',
  'samconfig.toml': 'aws',
  'clever.json': 'clever-cloud',
  'scalingo.json': 'scalingo',
};

/** Folder names of installed WordPress plugins, e.g. "mailchimp-for-wp". */
async function listWordPressPlugins(pluginsDir) {
  const entries = await readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name.toLowerCase());
}

async function walk(dir, depth, out, wpPlugins) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Third-party plugin code mentions every service the plugin can talk to, used or not:
      // the plugin's folder name says which vendor it is, so its code is not read.
      if (entry.name === 'plugins' && path.basename(dir) === 'wp-content') {
        for (const slug of await listWordPressPlugins(full)) wpPlugins.add(slug);
        continue;
      }
      // Hidden folders (.git, .next, .venv, ...) hold tooling and caches, not app code.
      const skip = SKIP_DIRS.has(entry.name) || WORDPRESS_CORE.has(entry.name) || entry.name.startsWith('.');
      if (!skip) await walk(full, depth + 1, out, wpPlugins);
    } else if (entry.isFile() && out.length < MAX_FILES) {
      out.push(full);
    }
  }
}

/** composer.json: the packages a PHP project depends on. */
function parseComposer(text) {
  const manifest = JSON.parse(text);
  return ['require', 'require-dev']
    .flatMap((field) => Object.keys(manifest[field] || {}))
    .filter((name) => name.includes('/'))
    .map((name) => name.toLowerCase());
}

function parseRequirements(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line && !line.startsWith('-'))
    .map((line) => line.split(/[<>=!~\[; ]/)[0].toLowerCase())
    .filter(Boolean);
}

function parsePyproject(text) {
  const names = [];
  // PEP 621: dependencies = ["x>=1", ...]
  for (const block of text.matchAll(/dependencies\s*=\s*\[([\s\S]*?)\]/g)) {
    for (const m of block[1].matchAll(/["']([A-Za-z0-9_.-]+)/g)) names.push(m[1].toLowerCase());
  }
  // Poetry: [tool.poetry.dependencies]
  const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (poetry) {
    for (const m of poetry[1].matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)) if (m[1] !== 'python') names.push(m[1].toLowerCase());
  }
  return names;
}

/** Pipfile: only the [packages] and [dev-packages] tables list dependencies. */
function parsePipfile(text) {
  const names = [];
  let inDependencies = false;
  for (const line of text.split(/\r?\n/)) {
    const table = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (table) {
      inDependencies = table[1] === 'packages' || table[1] === 'dev-packages';
      continue;
    }
    const dep = inDependencies && line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
    if (dep) names.push(dep[1].toLowerCase());
  }
  return names;
}

/** Variable names only. Values are never kept, even from template files. */
function parseEnvKeys(text) {
  return [...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => m[1]);
}

/**
 * @param {string} root
 */
export async function collectRepoSignals(root) {
  const abs = path.resolve(root);
  const info = await stat(abs).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`${root} is not a folder`);

  const files = [];
  const wpPlugins = new Set();
  await walk(abs, 0, files, wpPlugins);

  const npm = new Set();
  const pypi = new Set();
  const composer = new Set();
  const shopifyApps = new Set();
  const manifests = [];
  const configVendors = [];
  const envKeys = [];
  const envFiles = [];
  /** host -> first file it appears in */
  const sourceHosts = new Map();
  /** full URL -> first file it appears in, for vendor patterns with a path such as googletagmanager.com/gtag/js */
  const sourceUrls = new Map();
  let sourceFiles = 0;
  let sourceBytes = 0;

  for (const file of files) {
    const name = path.basename(file);
    const rel = path.relative(abs, file).replaceAll('\\', '/');
    if (Object.hasOwn(CONFIG_FILES, name)) configVendors.push({ vendorId: CONFIG_FILES[name], file: rel });
    // Every Shopify theme has this layout: the shop itself runs on Shopify.
    if (rel === 'layout/theme.liquid' || rel.endsWith('/layout/theme.liquid')) configVendors.push({ vendorId: 'shopify', file: rel });

    try {
      if (name === 'package.json') {
        const pkg = JSON.parse(await readFile(file, 'utf8'));
        for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
          Object.keys(pkg[field] || {}).forEach((dep) => npm.add(dep));
        }
        manifests.push(rel);
      } else if (/^requirements.*\.txt$/.test(name)) {
        parseRequirements(await readFile(file, 'utf8')).forEach((d) => pypi.add(d));
        manifests.push(rel);
      } else if (name === 'pyproject.toml') {
        parsePyproject(await readFile(file, 'utf8')).forEach((d) => pypi.add(d));
        manifests.push(rel);
      } else if (name === 'composer.json') {
        for (const dep of parseComposer(await readFile(file, 'utf8'))) {
          // WordPress sites managed with Composer (Bedrock) install plugins from WPackagist.
          if (dep.startsWith('wpackagist-plugin/')) wpPlugins.add(dep.slice('wpackagist-plugin/'.length));
          else composer.add(dep);
        }
        manifests.push(rel);
      } else if (SHOPIFY_THEME_JSON.test(rel)) {
        for (const [, handle] of (await readFile(file, 'utf8')).matchAll(SHOPIFY_APP_REF)) shopifyApps.add(handle);
      } else if (name === 'Pipfile') {
        parsePipfile(await readFile(file, 'utf8')).forEach((d) => pypi.add(d));
        manifests.push(rel);
      } else if (ENV_TEMPLATE.test(name)) {
        for (const key of parseEnvKeys(await readFile(file, 'utf8'))) envKeys.push({ key, file: rel });
        envFiles.push(rel);
      }

      const isSource = SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase()) && !GENERATED_FILE.test(rel);
      if (isSource && sourceFiles < MAX_SOURCE_FILES && sourceBytes < MAX_SOURCE_TOTAL_BYTES) {
        const { size } = await stat(file);
        if (size <= MAX_SOURCE_FILE_BYTES) {
          const text = await readFile(file, 'utf8');
          sourceFiles += 1;
          sourceBytes += size;
          for (const host of hostnameCandidates(text)) if (!sourceHosts.has(host)) sourceHosts.set(host, rel);
          for (const url of extractUrls(text)) {
            if (!sourceUrls.has(url) && sourceUrls.size < MAX_SOURCE_URLS) sourceUrls.set(url, rel);
          }
          if (name.endsWith('.liquid')) for (const [, handle] of text.matchAll(SHOPIFY_APP_REF)) shopifyApps.add(handle);
        }
      }
    } catch {
      /* skip unreadable or invalid files */
    }
  }

  return {
    root: abs,
    manifests,
    signals: {
      npm: [...npm],
      pypi: [...pypi],
      composer: [...composer],
      wpPlugins: [...wpPlugins],
      shopifyApps: [...shopifyApps],
      envKeys,
      hosts: [...sourceHosts].map(([host, where]) => ({ host, where, source: 'Source code' })),
      sourceUrls: [...sourceUrls].map(([url, where]) => ({ url, where })),
    },
    configVendors,
    coverage: {
      manifests: manifests.length,
      sourceFiles,
      envFiles: envFiles.length,
      wordpressPlugins: wpPlugins.size,
      shopifyApps: shopifyApps.size,
      truncated: files.length >= MAX_FILES || sourceFiles >= MAX_SOURCE_FILES || sourceBytes >= MAX_SOURCE_TOTAL_BYTES,
    },
  };
}
