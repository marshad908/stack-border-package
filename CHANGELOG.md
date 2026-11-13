# Changelog

All notable changes to this package are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-13

### Added

- Shopify themes: the platform is recognised from `layout/theme.liquid`, and apps embedded in the theme (`shopify://apps/...`) are reported.
- WordPress: installed plugins are recognised by their folder name in `wp-content/plugins` and from `wpackagist-plugin/*` in `composer.json`. Plugin code and WordPress core are not read, so services a plugin merely supports are not reported.
- `composer.json` is read for PHP dependencies (Laravel, Symfony and other PHP apps).
- Template files are read: Liquid, Twig, HTML, Handlebars, Nunjucks, ERB and EJS.
- 13 vendors, among them Jetpack (Automattic), Wordfence, Sucuri, OneSignal, Tidio, Judge.me, Okendo, Loox, Yotpo, Gorgias, Recharge, Omnisend and Privy, and Composer, WordPress plugin and Shopify app rules for 53 existing vendors.
- `report.coverage.repo` counts WordPress plugins and Shopify apps.

## [0.2.0] - 2026-11-13

### Added

- Privacy policy check: a domain scan finds the site's privacy policy and subprocessor page, and lists the confirmed vendors they do not name (`report.privacyPolicy`). Together with `--repo` it also covers server-side vendors. An unreadable policy is reported as such, never as missing vendors.
- `checkPrivacyPolicy` and `vendorsNamedIn` exports.

### Changed

- A domain scan without `--repo` now says plainly that server-side vendors cannot be seen from outside, and shows the command that includes them.

## [0.1.2] - 2026-11-12

### Fixed

- Repository scan: tag scripts written as a URL in source code are found, such as Google Analytics (`googletagmanager.com/gtag/js`) and Google Tag Manager (`gtm.js`). Before, only plain hostnames were matched, so vendors whose pattern includes a path were missed.
- Domain scan: the progress message now counts all of the site's own script files ("8 of 63 script files read"), not only the ones that were read.

## [0.1.1] - 2026-11-12

### Fixed

- Progress messages use the singular for one item ("1 vendor found", "1 of 1 script file read").

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
