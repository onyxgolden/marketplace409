import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  isFixLike,
  classifyFix,
  extractPrNumber,
  listFixCommits,
  filesForCommit,
  buildCatalog,
  formatMarkdownCatalog,
  mdCell,
} from '../buildBugCatalog.mjs';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'bugcat-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t.t');
  git(root, 'config', 'user.name', 't');
  return root;
}

import { writeFileSync as wfs, mkdirSync as mds } from 'node:fs';

function commitFileEsm(root, rel, content, subject, date) {
  const abs = join(root, rel);
  mds(join(abs, '..'), { recursive: true });
  wfs(abs, content, 'utf8');
  git(root, 'add', '-A');
  git(
    root,
    '-c',
    `user.email=t@t.t`,
    '-c',
    `user.name=t`,
    'commit',
    '-q',
    '-m',
    subject,
    '--date',
    date,
  );
}

describe('isFixLike', () => {
  it('matches fix language and conventional commits', () => {
    expect(isFixLike('fix: null pointer in ledger')).toBe(true);
    expect(isFixLike('fix(auth): refresh token race')).toBe(true);
    expect(isFixLike('Fixed the drawer auto-close')).toBe(true);
    expect(isFixLike('repair broken migration')).toBe(true);
    expect(isFixLike('hotfix for capture crash')).toBe(true);
    expect(isFixLike('correct rounding in totals')).toBe(true);
    expect(isFixLike('Revert "feat: risky change"')).toBe(true);
    expect(isFixLike('bugfix: validation message')).toBe(true);
  });
  it('rejects feature and chore commits', () => {
    expect(isFixLike('feat: add export button')).toBe(false);
    expect(isFixLike('chore: bump deps')).toBe(false);
    expect(isFixLike('prefix the route')).toBe(false); // "fix" inside "prefix" must not match
    expect(isFixLike('feat(doc-drift): Phase 2 draft fix proposals (read-only)')).toBe(false); // stray "fix"
    expect(isFixLike('refactor(auth): fix-adjacent cleanup')).toBe(false);
  });
});

describe('classifyFix', () => {
  it('classifies reverts, test fixes, docs fixes, and plain fixes', () => {
    expect(classifyFix('Revert "feat: x"')).toBe('revert');
    expect(classifyFix('fix: flaky test in ci')).toBe('test-fix');
    expect(classifyFix('fix typo in readme docs')).toBe('docs-fix');
    expect(classifyFix('fix: race in overlay')).toBe('fix');
  });
});

describe('extractPrNumber', () => {
  it('extracts PR numbers from squash-merge subjects', () => {
    expect(extractPrNumber('feat(doc-drift): Phase 2 (read-only) (#453)')).toBe(453);
    expect(extractPrNumber('Merge pull request #450 from x/y')).toBe(450);
    expect(extractPrNumber('fix: plain commit')).toBeNull();
  });
});

describe('listFixCommits / filesForCommit / buildCatalog', () => {
  it('builds a deterministic catalog from a synthetic repo', () => {
    const root = makeRepo();
    commitFileEsm(root, 'src/a.js', 'x', 'feat: add thing', '2026-01-01T10:00:00Z');
    commitFileEsm(root, 'src/a.js', 'y', 'fix: null pointer in ledger (#10)', '2026-01-02T10:00:00Z');
    commitFileEsm(root, 'src/b.js', 'z', 'chore: bump deps', '2026-01-03T10:00:00Z');
    commitFileEsm(root, 'src/c.js', 'w', 'Revert "feat: add thing"', '2026-01-04T10:00:00Z');

    const commits = listFixCommits(root);
    expect(commits.map((c) => c.subject)).toEqual(['fix: null pointer in ledger (#10)', 'Revert "feat: add thing"']);

    const files = filesForCommit(root, commits[0].sha);
    expect(files).toEqual(['src/a.js']);

    const { records } = buildCatalog({ root });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ subject: 'fix: null pointer in ledger (#10)', pr: 10, class: 'fix', files: ['src/a.js'] });
    expect(records[1]).toMatchObject({ class: 'revert', pr: null });

    // Deterministic: same bytes twice.
    const again = buildCatalog({ root });
    expect(JSON.stringify(again)).toBe(JSON.stringify({ repoHead: again.repoHead, records: again.records }));
    expect(JSON.stringify(records)).toBe(JSON.stringify(again.records));
  });

  it('dedupes and sorts files, caps records', () => {
    const root = makeRepo();
    for (let i = 0; i < 5; i++) {
      commitFileEsm(root, `src/f${i}.js`, 'x', `fix: issue ${i}`, `2026-02-0${i + 1}T10:00:00Z`);
    }
    const { records } = buildCatalog({ root, maxRecords: 3 });
    expect(records).toHaveLength(3);
    expect(records[0].subject).toBe('fix: issue 2'); // keeps the newest N
    expect(records[2].subject).toBe('fix: issue 4');
  });

  it('throws outside a git repo', () => {
    expect(() => buildCatalog({ root: mkdtempSync(join(tmpdir(), 'notgit-')) })).toThrow();
  });
});

describe('formatMarkdownCatalog', () => {
  it('renders a table and escapes pipes', () => {
    expect(mdCell('a|b')).toBe('a\\|b');
    const md = formatMarkdownCatalog({
      generatedAt: 't',
      repoHead: 'abc1234567890',
      records: [
        { date: '2026-01-02T10:00:00+00:00', class: 'fix', pr: 10, subject: 'fix: x|y', files: ['src/a.js'] },
        { date: '2026-01-04T10:00:00+00:00', class: 'revert', pr: null, subject: 'Revert "x"', files: [] },
      ],
    });
    expect(md).toContain('fix: x\\|y');
    expect(md).toContain('| 2026-01-02 | fix | #10 |');
    expect(md).toContain('mined from git history');
  });
});
