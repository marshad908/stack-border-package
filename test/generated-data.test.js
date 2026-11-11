import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatedSource } from '../scripts/generate-data.js';

test('src/generated-data.js matches data/vendors.json and package.json', () => {
  const onDisk = readFileSync(new URL('../src/generated-data.js', import.meta.url), 'utf8');
  assert.equal(onDisk, generatedSource(), 'Out of date: run `npm run generate` after changing data/vendors.json or the version.');
});
