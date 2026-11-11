import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToLines, hashLines, diffLines, extractUrls } from '../src/index.js';

describe('htmlToLines', () => {
  it('keeps visible text and drops scripts, styles and the head', () => {
    const html = `<html><head><title>Subprocessors</title><style>li{}</style></head>
      <body><ul><li>Acme GmbH &amp; Co</li><li>Beta Inc</li></ul><script>var a = "<li>hidden</li>"</script></body></html>`;
    assert.deepEqual(htmlToLines(html), ['Acme GmbH & Co', 'Beta Inc']);
  });

  it('splits table cells and block elements into lines', () => {
    const html = '<table><tr><td>Stripe</td><td>Payments</td><td>US</td></tr></table><p>Hetzner</p>';
    assert.deepEqual(htmlToLines(html), ['Stripe', 'Payments', 'US', 'Hetzner']);
  });

  it('decodes named and numeric entities', () => {
    assert.deepEqual(htmlToLines('<p>Caf&#233; &#x2014; &quot;EU&quot;&nbsp;GmbH</p>'), ['Café — "EU" GmbH']);
  });

  it('leaves invalid or unknown entities untouched instead of crashing', () => {
    assert.deepEqual(htmlToLines('<p>&#99999999; &#0; &bogus;</p>'), ['&#99999999; &#0; &bogus;']);
  });

  it('removes lines that change on every load', () => {
    const html = '<p>© 2026 Acme</p><p>Copyright Acme</p><p>Last updated 3 May</p><p>12:30</p><p>Stripe</p>';
    assert.deepEqual(htmlToLines(html), ['Stripe']);
  });

  it('removes duplicate lines, keeping the first', () => {
    assert.deepEqual(htmlToLines('<p>A1</p><p>B2</p><p>A1</p>'), ['A1', 'B2']);
  });

  it('handles a very large page quickly', () => {
    const html = Array.from({ length: 40_000 }, (_, i) => `<li>Vendor ${i}</li>`).join('');
    const started = Date.now();
    assert.equal(htmlToLines(html).length, 40_000);
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  });
});

describe('diffLines and hashLines', () => {
  it('reports added and removed lines and ignores reordering', () => {
    assert.deepEqual(diffLines(['a', 'b', 'c'], ['c', 'b', 'd']), { added: ['d'], removed: ['a'] });
    assert.deepEqual(diffLines(['a', 'b'], ['b', 'a']), { added: [], removed: [] });
  });

  it('hashes deterministically', () => {
    assert.equal(hashLines(['a', 'b']), hashLines(['a', 'b']));
    assert.notEqual(hashLines(['a', 'b']), hashLines(['b', 'a']));
    assert.match(hashLines([]), /^[0-9a-f]{64}$/);
  });
});

describe('extractUrls', () => {
  it('finds absolute and protocol-relative URLs and normalises them', () => {
    const urls = extractUrls('<script src="//js.stripe.com/v3/?x=1"></script> <a href="http://Example.com/a#b">x</a>');
    assert.deepEqual(urls.sort(), ['https://example.com/a', 'https://js.stripe.com/v3/']);
  });

  it('returns each URL once', () => {
    assert.equal(extractUrls('https://a.com/x https://a.com/x').length, 1);
  });
});
