// freeze-corpus.js — SHA-256 manifest binding fixtures, battery, oracle data,
// and all code. Sorted entries; digest written to corpus_digest.txt.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sha256Hex } from '../src/resolver.js';
import { canonicalStringify } from '../src/canonical.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((p) =>
  !p.endsWith('corpus_digest.txt') && !p.endsWith('manifest.json') &&
  (p.includes('/src/') || p.includes('/fixtures/store.json') || p.includes('/fixtures/keymap.json') ||
   p.includes('/fixtures/make-fixtures.js') ||
   p.includes('/corpus/battery.json') || p.includes('/corpus/trust-bootstrap.js') ||
   p.includes('/corpus/freeze-corpus.js') || p.includes('/corpus/make-battery.js') ||
   p.includes('/tests/') || p.includes('/runner/') ||
   p.endsWith('package.json') || p.endsWith('README.md'))
);

const manifest = files.map((p) => ({
  path: relative(ROOT, p),
  sha256: sha256Hex(readFileSync(p, 'utf8')),
})).sort((a, b) => a.path < b.path ? -1 : 1);

const digest = sha256Hex(canonicalStringify(manifest));
writeFileSync(join(ROOT, 'corpus', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(ROOT, 'corpus', 'corpus_digest.txt'), digest + '\n');
console.log(`manifest: ${manifest.length} files, digest ${digest}`);
