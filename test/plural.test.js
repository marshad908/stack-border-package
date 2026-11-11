import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural } from '../src/plural.js';

test('plural uses the singular only for exactly one', () => {
  assert.equal(plural(0, 'vendor'), '0 vendors');
  assert.equal(plural(1, 'vendor'), '1 vendor');
  assert.equal(plural(2, 'script file'), '2 script files');
  assert.equal(plural(1, 'unrecognized domain'), '1 unrecognized domain');
  assert.equal(plural(3, 'entry', 'entries'), '3 entries');
});
