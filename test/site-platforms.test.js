// Repositories built on a theme or plugin system: Shopify themes, WordPress sites and PHP apps.
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
const evidenceOf = (report, id) => report.vendors.find((v) => v.id === id)?.evidence;

describe('Shopify themes', () => {
  const theme = {
    'layout/theme.liquid': '<html>{{ content_for_header }}<script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script></html>',
    'templates/product.json': {
      sections: { main: { blocks: { badge: { type: 'shopify://apps/judge-me-reviews/blocks/preview_badge/61ccd3b1-a9f2-4160-9fe9-4fec8413e5d8' } } } },
    },
    'config/settings_data.json': { current: { blocks: { a: { type: 'shopify://apps/gorgias-live-chat-helpdesk/blocks/gorgias/1' } } } },
    'sections/footer.liquid': '{% schema %}{"blocks":[{"type":"@app"}]}{% endschema %}',
  };

  it('finds the platform, script tags in Liquid files and apps embedded in the theme', async () => {
    const report = await scan(theme);
    assert.deepEqual(ids(report), ['gorgias', 'judge-me', 'klaviyo', 'shopify']);
    assert.deepEqual(evidenceOf(report, 'judge-me'), [{ source: 'Shopify app', value: 'judge-me-reviews' }]);
    assert.deepEqual(evidenceOf(report, 'shopify'), [{ source: 'Deploy config', value: 'layout/theme.liquid' }]);
    assert.equal(report.coverage.repo.shopifyApps, 2);
  });

  it('does not treat an app handle that only shares a prefix as the vendor', async () => {
    const report = await scan({ 'templates/index.json': { a: { type: 'shopify://apps/privyx-tools/blocks/x/1' } } });
    assert.deepEqual(ids(report), []);
  });
});

describe('WordPress sites', () => {
  const site = {
    'wp-config-sample.php': '<?php // WordPress',
    'wp-includes/version.php': '<?php $url = "https://api.wordpress.org/core/version-check/";',
    'wp-content/plugins/mailchimp-for-wp/mailchimp-for-wp.php': '<?php // Plugin Name: MC4WP',
    'wp-content/plugins/woocommerce-gateway-stripe/stripe.php': '<?php',
    // A plugin that can talk to many services: its code must not turn those into findings.
    'wp-content/plugins/some-forms-plugin/integrations.php':
      '<?php $apis = ["https://api.hubapi.com", "https://api.sendgrid.com", "https://api.openai.com"];',
    'wp-content/themes/acme/footer.php': '<script src="https://www.googletagmanager.com/gtag/js?id=G-TEST1"></script>',
  };

  it('identifies plugins by folder name and reads the theme, but not plugin or core code', async () => {
    const report = await scan(site);
    assert.deepEqual(ids(report), ['google-analytics', 'mailchimp', 'stripe']);
    assert.deepEqual(evidenceOf(report, 'mailchimp'), [{ source: 'WordPress plugin', value: 'mailchimp-for-wp' }]);
    assert.equal(report.coverage.repo.wordpressPlugins, 3);
  });

  it('reads plugins installed through Composer (WPackagist), as Bedrock sites do', async () => {
    const report = await scan({ 'composer.json': { require: { 'roots/wordpress': '^6.6', 'wpackagist-plugin/mailchimp-for-wp': '^4.9' } } });
    assert.deepEqual(evidenceOf(report, 'mailchimp'), [{ source: 'WordPress plugin', value: 'mailchimp-for-wp' }]);
  });

  it('needs a wp-content parent to treat a folder as WordPress plugins', async () => {
    const report = await scan({ 'plugins/jetpack/jetpack.php': '<?php', 'themes/acme/index.php': '<?php' });
    // Without a wp-content parent there is no way to know these are WordPress plugins.
    assert.deepEqual(ids(report), []);
    const nested = await scan({ 'wp-content/plugins/jetpack/jetpack.php': '<?php' });
    assert.deepEqual(ids(nested), ['automattic']);
  });
});

describe('PHP applications', () => {
  it('reads require and require-dev from composer.json', async () => {
    const report = await scan({
      'composer.json': {
        require: { php: '^8.2', 'laravel/framework': '^11.0', 'stripe/stripe-php': '^15.0', 'google/cloud-storage': '^1.40' },
        'require-dev': { 'sentry/sentry-laravel': '^4.0' },
      },
    });
    assert.deepEqual(ids(report), ['gcp', 'sentry', 'stripe']);
    assert.deepEqual(evidenceOf(report, 'stripe'), [{ source: 'Composer package', value: 'stripe/stripe-php' }]);
    assert.deepEqual(report.meta.manifests, ['composer.json']);
  });

  it('survives a broken composer.json', async () => {
    const report = await scan({ 'composer.json': '{ not json' });
    assert.deepEqual(ids(report), []);
  });

  it('reads Twig and HTML templates', async () => {
    const report = await scan({
      'templates/base.html.twig': '<script src="https://js.stripe.com/v3/"></script>',
      'public/index.html': '<script defer data-domain="acme.example" src="https://plausible.io/js/script.js"></script>',
    });
    assert.deepEqual(ids(report), ['plausible', 'stripe']);
  });
});
