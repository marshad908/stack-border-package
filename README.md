# stackborder

[![Tests](https://github.com/marshad908/stack-border-package/actions/workflows/test.yml/badge.svg)](https://github.com/marshad908/stack-border-package/actions/workflows/test.yml)

Find out which third-party vendors a website or codebase sends data to, and how much of it stays under EU law.

```text
$ npx stackborder acme.example   # illustrative output for a fictional company

  acme.example
  Sovereignty score 61/100 (C)   3 EU · 4 outside the EU · 4 under the US CLOUD Act

  Cloudflare           CDN and edge         United States
                       EU options: bunny.net
  Google Workspace     Email and workspace  United States
                       EU options: Proton Mail, Tuta, mailbox.org
  Intercom             Customer support     United States (EU region in use)
                       EU options: Crisp, Userlike
  Stripe               Payments             United States
                       EU options: Mollie, Adyen
  Brevo                Marketing email      EU
  Hetzner              Hosting              EU
  Plausible Analytics  Analytics            EU

  Checked: DNS · homepage, 3 script files · security policy (CSP) · code not scanned (add --repo to find server-side vendors)

  Automated technical overview based on public signals. It can miss vendors that only run on the server side and it is not legal advice.
  Missed a vendor or found a wrong result? Tell us: https://github.com/marshad908/stack-border-package/issues
```

- **No account and no API key.** It runs on your machine and has zero dependencies.
- **Scan a website, a codebase, or both.** A public domain (DNS, HTTP headers, security policy, page scripts), a local repository (dependencies, API hosts in code, `.env.example` names, deploy configs), or both merged into one report.
- **Honest about gaps.** Every report says what was checked and lists third-party domains it could not identify, instead of hiding them.
- **A database of 189 vendors**, each with its headquarters, data-region options, subprocessor page and EU alternatives.
- **Built for CI.** Use `--fail-under` to fail a build when a new US vendor lowers your score.
- **EU AI Act hints.** AI SDKs it finds are listed as candidates for your AI system inventory.

> This is a technical overview based on public signals, not legal advice. It can miss vendors that only run on your servers. Scanning your repository as well closes most of that gap.

## Requirements

Node.js 20.10 or newer.

## Command line

```sh
npx stackborder <domain>                   # scan a public website
npx stackborder --repo <folder>            # scan a local codebase
npx stackborder <domain> --repo <folder>   # both, merged into one report
```

Not online yet? Scan the code with `--repo`. Local addresses such as `localhost:3000` or `192.168.1.20` cannot be scanned from the outside, and the command tells you so.

| Option | Description |
| --- | --- |
| `--repo <folder>` | Folder to scan. Reads `package.json`, `requirements*.txt`, `pyproject.toml`, `Pipfile` and deploy configs such as `vercel.json`, `fly.toml`, `netlify.toml` or `wrangler.toml`. Skips `node_modules`, hidden folders and build output. |
| `--json` | Print the full report as JSON on stdout and nothing else, so `> report.json` gives a clean file. |
| `--fail-under <score>` | Exit with code `2` when the score is below this number (0–100). |
| `--upload <url>` | Send the report to a Stackborder workspace. Requires `--token`. HTTPS only, except `localhost`. |
| `--token <token>` | Project upload token. |
| `-v`, `--version` | Print the version. |
| `-h`, `--help` | Show help. |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The scan finished (and met `--fail-under`, if given). |
| `1` | Invalid arguments, or the scan failed. |
| `2` | The score is below `--fail-under`. |

A scan that finds no vendors has no score, so it never fails `--fail-under`.

### Use in CI

GitHub Actions example:

```yaml
name: EU data sovereignty
on: [pull_request]

jobs:
  vendors:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx stackborder@0.1 --repo . --fail-under 60
```

Pin the version (`@0.1`) so a new release cannot break your pipeline without warning. While the version starts with `0.`, a new minor version (`0.2`) may change the output or the score.

## What it looks at

| Signal | Example finding |
| --- | --- |
| MX and SPF records | Google Workspace, Microsoft 365, SendGrid, Brevo |
| Nameservers, CNAME and reverse DNS | Cloudflare, Vercel, Netlify, AWS |
| HTTP response headers | `cf-ray` → Cloudflare, `x-vercel-id` → Vercel |
| Scripts, frames, images and preconnect hints on the homepage, and URLs inside up to 8 of the site's own script files | Stripe, Intercom, Google Analytics, PostHog EU |
| `Content-Security-Policy` header, which lists every origin the site may load from, including scripts injected at runtime | `js.stripe.com`, `*.posthog.com` |
| DNS TXT verification records | Reported as **likely**: they prove an account exists, not that data flows there |
| npm and Python dependencies | `@sentry/nextjs`, `openai`, `boto3` |
| API hosts written in source code | `fetch('https://api.mistral.ai/...')` → Mistral |
| Variable **names** in `.env.example`, `.env.sample` and `.env.template` | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_POSTHOG_KEY` |
| Deploy configuration files | `vercel.json` → Vercel, `fly.toml` → Fly.io |

Findings backed only by a TXT record or a CSP entry are marked **likely**: a policy can still list a service the site stopped using. Any second source makes them **confirmed**.

### Nothing is left out silently

Every report says what it could and could not check:

```text
  Third-party domains not in our database
  The site loads from these, but we cannot tell who runs them. Check them yourself.
  · sanity.io (csp header: cdn.sanity.io)

  Checked: DNS · homepage, 8 script files · security policy (CSP) · code not scanned (add --repo to find server-side vendors)
```

- **Unrecognized domains.** Third-party hosts the site loads from that match no vendor are listed instead of dropped (`report.unrecognized` in JSON).
- **Coverage.** `report.coverage` records whether DNS answered, whether the homepage loaded or was blocked by an anti-bot check, how many script files were read, whether a CSP was present, and how many manifests, source files and env templates a repository scan read.
- **Anti-bot pages are detected.** A challenge page is never scanned as if it were the real site; the report says the homepage was blocked.

## How the score works

Every vendor gets a weight for how sensitive its data usually is, and a factor for the jurisdiction it is under:

```text
score = Σ weight(category) × factor(jurisdiction) / Σ weight(category) × 100
```

| Category weight | |
| --- | --- |
| 3 | Hosting, database, storage, email, login |
| 2 | Payments, CRM, analytics, monitoring, support, AI, CDN, and similar |
| 1 | Everything else, such as fonts or maps |

| Jurisdiction | Factor |
| --- | --- |
| EU or EEA company | 1.0 |
| Country with an EU adequacy decision (UK, Switzerland, Japan, …) | 0.75 |
| US company with its EU data region in use | 0.4 |
| US company that offers an EU region | 0.3 |
| Other country outside the EU | 0.3 |
| US company, no EU region | 0.2 |

Grades: **A** ≥ 85, **B** ≥ 70, **C** ≥ 50, **D** ≥ 30, **E** below 30.

US companies score low even with EU hosting because the US CLOUD Act and FISA 702 can compel them to hand over data stored anywhere.

## Use it in code

The package is ESM-only.

```js
import { scanDomain, scanRepo, mergeVendorRows, buildReport } from 'stackborder';

const site = await scanDomain('your-company.eu', {
  onProgress: (step) => console.log(step.label, step.status),
});
const code = await scanRepo('./my-app');

console.log(site.score);
// Shape of the result (the numbers depend on the site):
// { score: 61, grade: 'C', eu: 3, nonEu: 4, cloudAct: 4, total: 7 }

for (const vendor of site.vendors) {
  console.log(vendor.name, vendor.region, vendor.alternatives.map((a) => a.name));
}

// Combine both scans into one report, the same way the CLI does.
const report = buildReport({
  target: site.target,
  kind: 'domain',
  vendors: mergeVendorRows(site.vendors, code.vendors),
});
```

### Main exports

| Export | Description |
| --- | --- |
| `scanDomain(domain, { onProgress })` | Scan a public website. Resolves to a `Report`. |
| `scanRepo(folder)` | Scan a local folder. Resolves to a `Report`. |
| `detectVendors(signals)` | Match raw signals (DNS records, headers, URLs, package names) against the database. |
| `computeScore(vendors)` | Score any list of `{ category, region, euRegion?, euRegionInUse? }`. |
| `listVendors()`, `getVendor(id)` | Read the vendor database. |
| `alternativesFor(vendorOrId)` | EU alternatives in the same category. |
| `safeFetch(url, options)` | HTTP GET with protection against server-side request forgery (see below). |
| `snapshotPage(url)`, `diffLines(before, after)` | Watch a vendor's subprocessor page for changes. |
| `VERSION` | The package version. |

TypeScript types are included. The raw database is available as `stackborder/vendors.json`:

```js
import db from 'stackborder/vendors.json' with { type: 'json' };
```

### Errors

Network and input problems throw a `FetchError` with a `code`:

| Code | When |
| --- | --- |
| `INPUT` | The domain or URL is not valid. |
| `DNS` | The domain does not resolve. |
| `PRIVATE` | The target resolves to a private, loopback or cloud-metadata address. |
| `PORT`, `PROTOCOL` | Only `http`/`https` on ports 80 and 443 are allowed. |
| `TIMEOUT`, `REDIRECTS`, `NETWORK` | The request took too long, redirected too often, or failed. |

## Privacy and security

- **Repository scans never leave your machine.** Files are read locally. Only `--upload` sends anything, and then only the finished report: vendor names and the evidence lines shown in the output, never your source code.
- **Domain scans** make ordinary public DNS queries and fetch the homepage plus up to eight of the site's own script files, like a browser would. If your system resolver refuses direct DNS queries (common behind VPNs), it falls back to Quad9 and then Cloudflare. Set `SCAN_DNS_SERVERS=1.2.3.4,5.6.7.8` to choose your own.
- **Safe to run on user input.** If you expose scans in your own service, `safeFetch` refuses private, loopback, link-local and cloud-metadata addresses (including IPv4 addresses hidden inside IPv6), pins each connection to the address it checked to prevent DNS rebinding, checks every redirect again, and caps the total time and response size.

## Limitations

- Vendors used only on the server side (for example a database behind your API) are invisible to a domain scan. Add `--repo`.
- A vendor that is not in the database is not scored. When the site loads from it, it is listed under unrecognized domains so you can check it.
- Scripts that load only after a click or a cookie consent are not run; the CSP header and the site's own bundles usually still reveal them.
- Real `.env` files are never opened, so a vendor configured only there and nowhere in code or templates is not found.
- Large repositories are read up to 4,000 source files (40 MB); the report says when that limit was reached.
- The jurisdiction is the vendor company's headquarters. Contracts, data-processing agreements and transfer mechanisms are out of scope.

## Feedback and security

- **A vendor is missing or a result looks wrong?** [Open an issue](https://github.com/marshad908/stack-border-package/issues) with the domain or the line from the report. Missing vendors are usually added in the next release.
- **Found a security problem?** Please do not open a public issue. Report it privately through [GitHub security advisories](https://github.com/marshad908/stack-border-package/security/advisories/new).

## License

[MIT](./LICENSE)
