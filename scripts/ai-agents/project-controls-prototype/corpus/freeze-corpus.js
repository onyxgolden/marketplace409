// freeze-corpus.js — (re)generates corpus/manifest.json + corpus_digest.txt.
// Run AFTER make-fixtures.js and make-battery.js. The manifest binds every
// corpus constituent by SHA-256; run-battery.js verifies before execution.

import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const files = [
  'fixtures/store.json',
  'fixtures/keymap.json',
  'fixtures/make-fixtures.js',
  'corpus/battery.json',
  'corpus/make-battery.js',
  'tests/run-battery.js',
  'runner/run-manual.js',
  'package.json',
  'README.md',
];
for (const f of readdirSync(join(root, 'tests'))) {
  if (f.endsWith('.test.js')) files.push(`tests/${f}`);
}
files.sort();

const pinned = {};
for (const f of files) pinned[f] = sha256File(join(root, f));

const manifest = { version: '1', files: pinned };
writeFileSync(join(root, 'corpus', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const digest = sha256File(join(root, 'corpus', 'manifest.json'));
writeFileSync(join(root, 'corpus', 'corpus_digest.txt'), digest + '\n');
console.log(`manifest frozen: ${files.length} files, digest ${digest}`);
