# Changelog

All notable changes to this package are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-12

First public release.

### Added

- `stackborder` command line tool: scan a domain, a repository, or both, with `--json`, `--fail-under`, `--upload` and `--version`.
- Domain scan using DNS (MX, SPF, TXT, NS, CNAME, PTR), HTTP headers, the `Content-Security-Policy` header, resources loaded by the homepage and up to 8 of the site's own script files.
- Repository scan of `package.json`, `requirements*.txt`, `pyproject.toml` (PEP 621 and Poetry), `Pipfile`, common deploy configs, API hosts in source code and variable names in `.env.example` files. Real `.env` files are never read.
- `report.coverage` and `report.unrecognized`: every report states what was checked and lists third-party domains that match no known vendor.
- Detection of anti-bot challenge pages, reported instead of being scanned as the real site.
- Vendor database with 189 vendors, their jurisdiction, EU data-region options, subprocessor pages and EU alternatives.
- Sovereignty score (0–100, grades A–E) with a published formula.
- EU AI Act inventory suggestions for detected AI vendors.
- `safeFetch` with protection against server-side request forgery, and subprocessor page snapshots and diffs.
- TypeScript type definitions.
