#!/usr/bin/env node
// Command-line interface for stackborder.
//
// Exit codes
//   0  scan finished
//   1  usage error or scan failure
//   2  the score is below --fail-under (useful in CI)
import { parseArgs } from 'node:util';
import { scanDomain, scanRepo, mergeVendorRows, buildReport, REGION_LABELS, VERSION } from '../src/index.js';
import { createRequire } from 'node:module';
import { plural } from '../src/plural.js';

// The CLI is never bundled, so it reads package.json with require (a JSON import warns on older Node).
const pkg = createRequire(import.meta.url)('../package.json');

const EXIT_ERROR = 1;
const EXIT_BELOW_THRESHOLD = 2;
const UPLOAD_TIMEOUT_MS = 30_000;

const HELP = `stackborder ${VERSION}
See which vendors your SaaS sends data to, and how much of it stays under EU law.

Usage
  stackborder <domain>                   Scan a public website (DNS, headers, security policy, page scripts)
  stackborder --repo <folder>            Scan dependencies, source code and deploy configs
  stackborder <domain> --repo <folder>   Both, merged into one report

Options
  --repo <folder>        Folder to scan: package.json, requirements*.txt, pyproject.toml, Pipfile,
                         API hosts in source code, variable names in .env.example files
                         (never .env itself) and deploy configs such as vercel.json or fly.toml
  --json                 Print the full report as JSON on stdout
  --fail-under <score>   Exit with code 2 when the score is below this number (0-100)
  --upload <url>         Send the report to your Stackborder workspace (requires --token)
  --token <token>        Project upload token from Dashboard > Project > Settings
  -v, --version          Print the version
  -h, --help             Show this help

Examples
  npx stackborder acme.eu
  npx stackborder --repo . --fail-under 60
  npx stackborder acme.eu --repo . --json > report.json

Privacy
  Only public DNS and HTTP lookups leave your machine. Repository files are read
  locally and never sent anywhere unless you pass --upload.

This is a technical overview, not legal advice.`;

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

function colorEnabled(stream) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}

function palette(enabled) {
  const paint = (code) => (text) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : String(text));
  return { bold: paint(1), dim: paint(2), red: paint(31), green: paint(32), yellow: paint(33) };
}

const out = palette(colorEnabled(process.stdout));
const err = palette(colorEnabled(process.stderr));

const REGION_COLOR = { eu: out.green, eea: out.green, adequate: out.yellow, us: out.red, other: out.yellow, unknown: out.dim };

function scoreColor(score) {
  if (score >= 70) return out.green;
  if (score >= 40) return out.yellow;
  return out.red;
}

function formatReport(report) {
  const { score } = report;
  const lines = ['', out.bold(`  ${report.target}`)];

  if (score.score === null) {
    lines.push(out.dim('  No third-party vendors detected.'));
  } else {
    const headline = scoreColor(score.score)(out.bold(`${score.score}/100 (${score.grade})`));
    lines.push(`  Sovereignty score ${headline}   ${score.eu} EU · ${score.nonEu} outside the EU · ${score.cloudAct} under the US CLOUD Act`);
  }
  lines.push('');

  const nameWidth = Math.max(10, ...report.vendors.map((v) => v.name.length));
  const categoryWidth = Math.max(...report.vendors.map((v) => v.categoryLabel.length), 0);
  for (const v of report.vendors) {
    const euRegion = v.region === 'us' && v.euRegionInUse ? ' (EU region in use)' : '';
    const confidence = v.confidence === 'likely' ? out.dim(' · account found, usage not confirmed') : '';
    const where = REGION_COLOR[v.region](`${REGION_LABELS[v.region]}${euRegion}`) + confidence;
    lines.push(`  ${v.name.padEnd(nameWidth)}  ${out.dim(v.categoryLabel.padEnd(categoryWidth))}  ${where}`);
    if (v.alternatives.length) {
      lines.push(out.dim(`  ${''.padEnd(nameWidth)}  EU options: ${v.alternatives.map((a) => a.name).join(', ')}`));
    }
  }

  if (report.aiSystems.length) {
    lines.push('', out.bold('  AI systems to add to your EU AI Act inventory'));
    for (const s of report.aiSystems) lines.push(`  · ${s.name} ${out.dim(`(suggested: ${s.suggestedTier} risk, please confirm)`)}`);
  }
  if (report.unrecognized?.length) {
    lines.push('', out.bold('  Third-party domains not in our database'));
    lines.push(out.dim('  The site loads from these, but we cannot tell who runs them. Check them yourself.'));
    for (const u of report.unrecognized) {
      const hosts = u.hosts.length > 1 || u.hosts[0] !== u.domain ? `: ${u.hosts.join(', ')}` : '';
      lines.push(`  · ${u.domain} ${out.dim(`(${u.source.toLowerCase()}${hosts})`)}`);
    }
  }

  if (report.privacyPolicy) lines.push('', ...describePrivacyPolicy(report.privacyPolicy, report.vendors));

  lines.push('', `  ${out.dim('Checked:')} ${describeCoverage(report.coverage)}`);
  if (report.kind === 'domain' && !report.coverage.repo) {
    lines.push(out.yellow('  A domain scan only sees what the website loads in a browser. Server-side vendors such as'));
    lines.push(out.yellow('  databases, email, AI and payments cannot be seen from outside. To include them, run in your'));
    lines.push(out.yellow(`  project folder: npx stackborder ${report.target} --repo .`));
  }
  for (const note of report.notes) lines.push(out.yellow(`  note: ${note}`));
  lines.push('', out.dim(`  ${report.disclaimer}`));
  const feedbackUrl = pkg.bugs?.url;
  if (feedbackUrl) lines.push(out.dim(`  Missed a vendor or found a wrong result? Tell us: ${feedbackUrl}`));
  lines.push('');
  return lines.join('\n');
}


/** Which detected vendors the privacy policy leaves out. Only a policy whose text was read is judged. */
function describePrivacyPolicy(policy, vendors) {
  const lines = [out.bold('  Privacy policy')];
  if (policy.status === 'not-found') return [...lines, out.dim('  No privacy policy was found from the homepage, so it was not compared.')];
  if (policy.status === 'unreadable') {
    return [...lines, out.dim(`  Found at ${policy.url}, but its text could not be read (it may be built by JavaScript), so it was not compared.`)];
  }

  lines.push(out.dim(`  ${[policy.url, policy.subprocessorsUrl].filter(Boolean).join(' and ')}`));
  const nameOf = new Map(vendors.map((v) => [v.id, v.name]));
  const notNamed = policy.notNamedVendorIds.map((id) => nameOf.get(id) ?? id);
  if (!notNamed.length) return [...lines, out.green('  Every vendor found here is named in it.')];
  return [
    ...lines,
    out.yellow(`  Not named in it: ${notNamed.join(', ')}`),
    out.dim('  Visitors should be told who receives their data. Check whether these belong in the policy.'),
  ];
}

/** One line that tells the reader how complete this report is. */
function describeCoverage(coverage = {}) {
  const parts = [];
  if (coverage.dns !== undefined) {
    parts.push(coverage.dns ? 'DNS' : 'no DNS');
    if (coverage.homepage === 'ok') parts.push(`homepage, ${plural(coverage.scripts, 'script file')}`);
    else if (coverage.homepage === 'blocked') parts.push(out.yellow('homepage blocked by an anti-bot check'));
    else parts.push(out.yellow('homepage unreachable'));
    parts.push(coverage.csp ? 'security policy (CSP)' : 'no CSP header');
    if (coverage.privacyPolicy) {
      parts.push({ read: 'privacy policy', unreadable: 'privacy policy unreadable', 'not-found': 'no privacy policy found' }[coverage.privacyPolicy]);
    }
  }
  if (coverage.repo) {
    const r = coverage.repo;
    parts.push(`${plural(r.manifests, 'manifest')}, ${plural(r.sourceFiles, 'source file')}, ${plural(r.envFiles, '.env template')}`);
  } else {
    parts.push(out.yellow('code not scanned'));
  }
  return parts.join(' · ');
}

function printProgress(step) {
  if (step.status === 'running') return;
  const mark = step.status === 'done' ? '✓' : '–';
  process.stderr.write(err.dim(`  ${mark} ${step.label}${step.detail ? `: ${step.detail}` : ''}\n`));
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        repo: { type: 'string' },
        json: { type: 'boolean', default: false },
        upload: { type: 'string' },
        token: { type: 'string' },
        'fail-under': { type: 'string' },
        version: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }

  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new UsageError(`Expected one domain, got ${positionals.length}: ${positionals.join(' ')}`);

  let failUnder = null;
  if (values['fail-under'] !== undefined) {
    failUnder = Number(values['fail-under']);
    if (!Number.isInteger(failUnder) || failUnder < 0 || failUnder > 100) {
      throw new UsageError(`--fail-under must be a whole number from 0 to 100, got "${values['fail-under']}"`);
    }
  }

  let uploadUrl = null;
  if (values.upload !== undefined) {
    if (!values.token) throw new UsageError('--upload requires --token (copy it from your project settings)');
    uploadUrl = parseUploadUrl(values.upload);
  } else if (values.token) {
    throw new UsageError('--token is only used together with --upload');
  }

  return {
    domain: positionals[0] ?? null,
    repo: values.repo ?? null,
    json: values.json,
    failUnder,
    uploadUrl,
    token: values.token ?? null,
    help: values.help,
    version: values.version,
  };
}

/** The upload token is a secret: only send it over HTTPS (plain HTTP is allowed for local testing). */
function parseUploadUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new UsageError(`--upload expects a URL such as https://app.example.eu, got "${input}"`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new UsageError('--upload must use https:// so your token is never sent unencrypted');
  }
  return url;
}

// Addresses that only exist on the user's own machine or network. A domain scan looks at a site
// from the outside, so these cannot be scanned; the error points to --repo instead.
const LOCAL_ADDRESSES = [
  /^localhost$/,
  /\.(localhost|local|internal|lan|home|test|example|invalid)$/, // local-only or reserved names
  /^[^.]+$/, // a single name such as "myapp", which only resolves inside a network
  /^(127|10)\.\d+\.\d+\.\d+$/, // loopback and private IPv4
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // link-local
  /^\[.*\]$/, // IPv6 addresses such as [::1]
];

function isLocalAddress(input) {
  try {
    const { hostname } = new URL(/^[a-z]+:\/\//i.test(input) ? input : `http://${input}`);
    return LOCAL_ADDRESSES.some((pattern) => pattern.test(hostname));
  } catch {
    return false; // not an address at all: the normal "not a valid domain" message explains it
  }
}

function localAddressMessage(domain, repo) {
  const next = repo
    ? `Leave out the domain to scan only the code: npx stackborder --repo ${repo}`
    : 'To scan a project that is not online yet, run: npx stackborder --repo .';
  return `"${domain}" is not a public domain, so it cannot be scanned from the outside.\n  ${next}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function runScans({ domain, repo, json }) {
  const reports = [];
  if (domain) reports.push(await scanDomain(domain, { onProgress: json ? undefined : printProgress }));
  if (repo) reports.push(await scanRepo(repo));
  if (reports.length === 1) return reports[0];

  const [site, code] = reports;
  return buildReport({
    target: site.target,
    kind: 'domain',
    vendors: mergeVendorRows(site.vendors, code.vendors),
    unrecognized: site.unrecognized,
    privacyPolicy: site.privacyPolicy,
    coverage: { ...site.coverage, ...code.coverage },
    notes: [...site.notes, ...code.notes],
    meta: { ...site.meta, repo: code.meta },
  });
}

async function uploadReport(report, baseUrl, token) {
  const endpoint = new URL('/api/ingest', baseUrl);
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? `no answer within ${UPLOAD_TIMEOUT_MS / 1000} s` : error.message;
    throw new Error(`Upload to ${endpoint.origin} failed: ${reason}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Upload rejected (HTTP ${res.status}): ${body.error || res.statusText}`);
  return body;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    console.log(HELP);
    return EXIT_ERROR;
  }
  const options = parseCli(argv);

  if (options.version) {
    console.log(VERSION);
    return 0;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (!options.domain && !options.repo) throw new UsageError('Pass a domain, --repo <folder>, or both');
  if (options.domain && isLocalAddress(options.domain)) throw new UsageError(localAddressMessage(options.domain, options.repo));

  const report = await runScans(options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));

  if (options.uploadUrl) {
    const result = await uploadReport(report, options.uploadUrl, options.token);
    process.stderr.write(err.green(`  Uploaded: ${result.added ?? 0} new, ${result.updated ?? 0} updated vendors.\n`));
  }

  const belowThreshold = options.failUnder !== null && report.score.score !== null && report.score.score < options.failUnder;
  if (belowThreshold) {
    process.stderr.write(err.red(`  Score ${report.score.score} is below the required ${options.failUnder}.\n`));
    return EXIT_BELOW_THRESHOLD;
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(err.red(`\n  Error: ${error.message}\n`));
    if (error instanceof UsageError) process.stderr.write(err.dim('  Run "stackborder --help" for usage.\n'));
    process.stderr.write('\n');
    process.exitCode = EXIT_ERROR;
  },
);
