/**
 * checkDocDrift.test.mjs — Phase 1 W3 test plan.
 *
 * Covers: no-change byte-identical reports, missing manifest, malformed
 * stamps, duplicate/retry idempotence, broken links, valid sibling links,
 * and source-unavailable cases — plus the unit contracts the checks rely on.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterEach } from 'vitest';

import {
  STATES,
  REVIEW_AGE_DAYS,
  checkDocAge,
  checkDocLinks,
  checkLiveIndex,
  checkSnapshotSync,
  classifyAge,
  defaultGit,
  extractHeadingIds,
  extractLinks,
  extractReferenceDefinitions,
  formatMarkdownSummary,
  isPlaceholderTarget,
  mdCell,
  parseReviewStamp,
  reportableTarget,
  resolveLinkTarget,
  runDriftCheck,
  sanitizeTarget,
  slugifyHeading,
} from '../checkDocDrift.mjs';

// Portable: derive the CLI script path from this test file's location, so the
// CLI tests run on CI, other developer machines, and Jason's machines.
const SCRIPT = fileURLToPath(new URL('../checkDocDrift.mjs', import.meta.url));

const tmpRoots = [];
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'doc-drift-'));
  tmpRoots.push(root);
  return root;
}
afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop(), { recursive: true, force: true });
});

function writeDoc(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

const fakeGit = (head = 'a'.repeat(40)) => ({
  headSha: () => head,
  objectExists: () => true,
  isAncestor: () => true,
  commitsBetween: () => 3,
});

const AS_OF = new Date('2026-09-28T12:00:00Z');

// ---------------------------------------------------------------------------

describe('sanitizeTarget', () => {
  it('strips query strings and fragments', () => {
    expect(sanitizeTarget('guide.md?token=secret#section')).toBe('guide.md');
  });
  it('strips embedded credentials', () => {
    expect(sanitizeTarget('https://user:pass@host/x.md')).toBe('https://host/x.md');
  });
  it('leaves plain relative paths alone', () => {
    expect(sanitizeTarget('../docs/other.md')).toBe('../docs/other.md');
  });
});

describe('extractLinks', () => {
  it('extracts inline links with 1-based line numbers', () => {
    const links = extractLinks('# T\n\nSee [a](a.md) and [b](../b.md).\n');
    expect(links.map((l) => [l.target, l.line])).toEqual([
      ['a.md', 3],
      ['../b.md', 3],
    ]);
  });
  it('ignores links inside fenced code blocks', () => {
    const md = '# T\n\n```\n[fake](nope.md)\n```\n\n[real](yes.md)\n';
    expect(extractLinks(md).map((l) => l.target)).toEqual(['yes.md']);
  });
  it('extracts image targets too', () => {
    expect(extractLinks('![alt](img.png)\n').map((l) => l.target)).toEqual(['img.png']);
  });
});

describe('headings and anchors', () => {
  it('slugifies headings GitHub-style', () => {
    expect(slugifyHeading('Getting Started!')).toBe('getting-started');
  });
  it('extracts heading ids', () => {
    expect(extractHeadingIds('# Hello World\n\n## Foo_Bar\n')).toContain('hello-world');
  });
});

describe('resolveLinkTarget', () => {
  it('resolves an exact file', () => {
    const root = makeRoot();
    writeDoc(root, 'docs/a.md', '# a');
    writeDoc(root, 'docs/b.md', '# b');
    const r = resolveLinkTarget({ docDir: join(root, 'docs'), target: 'b.md' });
    expect(r.kind).toBe('resolved');
  });
  it('marks a missing target dead', () => {
    const root = makeRoot();
    writeDoc(root, 'docs/a.md', '# a');
    const r = resolveLinkTarget({ docDir: join(root, 'docs'), target: 'ghost.md' });
    expect(r.kind).toBe('dead');
  });
  it('resolves a single case-variant match', () => {
    const root = makeRoot();
    const r = resolveLinkTarget({
      docDir: join(root, 'docs'),
      target: 'Guide.MD',
      readDir: () => ['guide.md'],
    });
    expect(r.kind).toBe('resolved');
    expect(r.note).toBe('case-variant-match');
  });
  it('marks ambiguous case variants unresolved', () => {
    const r = resolveLinkTarget({
      docDir: '/x',
      target: 'Guide.MD',
      readDir: () => ['guide.md', 'GUIDE.md'],
    });
    expect(r.kind).toBe('unresolved');
  });
  it('treats documented placeholders as intentional', () => {
    expect(isPlaceholderTarget('TBD')).toBe(true);
    const r = resolveLinkTarget({ docDir: '/x', target: 'coming-soon.md' });
    expect(r.note).toBe('intentional-placeholder-per-rule');
  });
  it('skips external targets', () => {
    const r = resolveLinkTarget({ docDir: '/x', target: 'https://example.com/y' });
    expect(r.note).toBe('external-skipped');
  });
});

describe('review stamps', () => {
  it('parses a Last Updated stamp', () => {
    const d = parseReviewStamp('# T\n\nLast Updated: 2026-01-15\n');
    expect(d.toISOString().slice(0, 10)).toBe('2026-01-15');
  });
  it('returns null when no stamp exists', () => {
    expect(parseReviewStamp('# T\n\nNo stamp here.\n')).toBeNull();
  });
  it('ignores mid-paragraph dates (explicit convention only)', () => {
    expect(parseReviewStamp('# T\n\nThe Date: 2020-01-01 release was big.\n')).toBeNull();
    expect(parseReviewStamp('# T\n\nUpdated sometime in 2020.\n')).toBeNull();
  });
  it('rejects impossible dates', () => {
    expect(parseReviewStamp('Last Updated: 2026-13-45\n')).toBeNull();
    expect(parseReviewStamp('Last Updated: 2026-02-30\n')).toBeNull();
  });
  it('old stamps yield REVIEW_PENDING, never STALE', () => {
    const old = new Date('2020-01-01T00:00:00Z');
    expect(classifyAge(old, AS_OF)).toBe(STATES.REVIEW_PENDING);
    expect(classifyAge(old, AS_OF)).not.toBe(STATES.STALE);
  });
  it('recent stamps yield CURRENT', () => {
    const recent = new Date(AS_OF.getTime() - 10 * 86_400_000);
    expect(classifyAge(recent, AS_OF)).toBe(STATES.CURRENT);
  });
  it('missing stamps yield UNKNOWN', () => {
    expect(classifyAge(null, AS_OF)).toBe(STATES.UNKNOWN);
  });
});

describe('C1 snapshot sync', () => {
  it('UNKNOWN when the manifest is missing', () => {
    const root = makeRoot();
    const r = checkSnapshotSync({ root, git: fakeGit() });
    expect(r.state).toBe(STATES.UNKNOWN);
    expect(r.evidence.reason).toBe('manifest-missing');
  });
  it('UNKNOWN on malformed sha', () => {
    const root = makeRoot();
    writeDoc(root, 'engineering-brain/index-manifest.json', '{"commit_sha":"zzz"}');
    const r = checkSnapshotSync({ root, git: fakeGit() });
    expect(r.state).toBe(STATES.UNKNOWN);
    expect(r.evidence.reason).toBe('sha-missing-or-malformed');
  });
  it('CURRENT when indexed sha equals HEAD', () => {
    const root = makeRoot();
    const head = 'b'.repeat(40);
    writeDoc(root, 'engineering-brain/index-manifest.json', JSON.stringify({ commit_sha: head }));
    const r = checkSnapshotSync({ root, git: fakeGit(head) });
    expect(r.state).toBe(STATES.CURRENT);
    expect(r.evidence.comparison).toBe('synchronized-to-selected-HEAD');
  });
  it('STALE marks the sync check only, never the indexed documents', () => {
    const root = makeRoot();
    const head = 'b'.repeat(40);
    writeDoc(root, 'engineering-brain/index-manifest.json', JSON.stringify({ commit_sha: 'a'.repeat(40) }));
    const r = checkSnapshotSync({ root, git: fakeGit(head) });
    expect(r.state).toBe(STATES.STALE);
    expect(r.check).toBe('C1.snapshot-sync');
    expect(r.evidence.indexedSha).toBe('a'.repeat(40));
    expect(r.evidence.checkedHead).toBe(head);
    expect(r.evidence.note).toMatch(/NOT marked stale/);
  });
  it('UNKNOWN when the indexed sha is not in the repo', () => {
    const root = makeRoot();
    writeDoc(root, 'engineering-brain/index-manifest.json', JSON.stringify({ commit_sha: 'c'.repeat(40) }));
    const git = { ...fakeGit(), objectExists: () => false, isShallow: () => false };
    const r = checkSnapshotSync({ root, git });
    expect(r.state).toBe(STATES.UNKNOWN);
    expect(r.evidence.reason).toBe('indexed-sha-not-in-repo');
  });
  it('UNKNOWN with a shallow-clone reason when ancestry is unverifiable', () => {
    const root = makeRoot();
    writeDoc(root, 'engineering-brain/index-manifest.json', JSON.stringify({ commit_sha: 'c'.repeat(40) }));
    const git = { ...fakeGit(), objectExists: () => false, isShallow: () => true };
    const r = checkSnapshotSync({ root, git });
    expect(r.state).toBe(STATES.UNKNOWN);
    expect(r.evidence.reason).toBe('indexed-sha-unverifiable-shallow-clone');
  });
});

describe('C2 live index', () => {
  it('always UNKNOWN without authorized DB access', () => {
    const r = checkLiveIndex();
    expect(r.state).toBe(STATES.UNKNOWN);
    expect(r.evidence.reason).toBe('no-authorized-db-access');
  });
});

describe('reference-style links', () => {
  it('resolves full, collapsed, and shortcut references', () => {
    const md = '# T\n\nSee [a][id1], [b][], and [c].\n\n[id1]: b.md\n[b]: b.md\n[c]: b.md\n';
    expect(extractLinks(md).map((l) => l.target)).toEqual(['b.md', 'b.md', 'b.md']);
  });
  it('parses reference definitions', () => {
    const defs = extractReferenceDefinitions('[a]: ./x.md\n[^1]: footnote\n');
    expect(defs.get('a')).toBe('./x.md');
    expect(defs.has('^1')).toBe(false);
  });
  it('flags undefined references as STALE', () => {
    const root = makeRoot();
    const rs = checkDocLinks({
      docRepoPath: 'a.md',
      markdown: '# T\n\nSee [x][nope].\n',
      docDir: root,
    });
    const stale = rs.filter((r) => r.check === 'C3.link');
    expect(stale).toHaveLength(1);
    expect(stale[0].evidence.reason).toBe('reference-undefined');
  });
  it('flags broken reference targets as STALE', () => {
    const root = makeRoot();
    const rs = checkDocLinks({
      docRepoPath: 'a.md',
      markdown: '# T\n\nSee [x][gone].\n\n[gone]: ghost.md\n',
      docDir: root,
    });
    const stale = rs.filter((r) => r.check === 'C3.link' && r.state === 'STALE');
    expect(stale).toHaveLength(1);
    expect(stale[0].evidence.linkTarget).toBe('ghost.md');
  });
  it('ignores footnote syntax', () => {
    expect(extractLinks('# T\n\nNote[^1].\n\n[^1]: a footnote\n')).toHaveLength(0);
  });
  it('extracts autolinks to internal paths', () => {
    const links = extractLinks('# T\n\nSee <./b.md> and <https://example.com>.\n');
    expect(links.map((l) => l.target)).toEqual(['./b.md', 'https://example.com']);
  });
});

describe('cross-document anchors', () => {
  it('validates anchors against the target document headings', () => {
    const root = makeRoot();
    writeDoc(root, 'docs/b.md', '# Hello World\n');
    const good = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: '# A\n\nSee [x](b.md#hello-world).\n',
      docDir: join(root, 'docs'),
    });
    expect(good.filter((r) => r.check === 'C3.link')).toHaveLength(0);
    const bad = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: '# A\n\nSee [x](b.md#nope).\n',
      docDir: join(root, 'docs'),
    });
    const stale = bad.filter((r) => r.check === 'C3.link');
    expect(stale).toHaveLength(1);
    expect(stale[0].evidence.reason).toBe('anchor-absent');
  });
  it('marks unreadable targets REVIEW_PENDING', () => {
    const root = makeRoot();
    writeDoc(root, 'docs/b.md', '# B\n');
    const rs = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: '# A\n\nSee [x](b.md#sec).\n',
      docDir: join(root, 'docs'),
      readFile: () => null,
    });
    const findings = rs.filter((r) => r.check === 'C3.link');
    expect(findings).toHaveLength(1);
    expect(findings[0].state).toBe(STATES.REVIEW_PENDING);
    expect(findings[0].evidence.reason).toBe('target-unreadable');
  });
});

describe('link resolution edge cases', () => {
  it('strips query strings before filesystem resolution', () => {
    const root = makeRoot();
    writeDoc(root, 'docs/guide.md', '# G\n');
    const rs = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: '# A\n\nSee [g](guide.md?view=1).\n',
      docDir: join(root, 'docs'),
    });
    expect(rs.filter((r) => r.check === 'C3.link')).toHaveLength(0);
    expect(rs.find((r) => r.check === 'C3.links-summary').state).toBe(STATES.CURRENT);
  });
  it('redacts absolute paths instead of resolving or echoing them', () => {
    const root = makeRoot();
    const rs = checkDocLinks({
      docRepoPath: 'a.md',
      markdown: '# A\n\nSee [x](/etc/passwd).\n',
      docDir: root,
    });
    const findings = rs.filter((r) => r.check === 'C3.link');
    expect(findings).toHaveLength(1);
    expect(findings[0].state).toBe(STATES.REVIEW_PENDING);
    expect(findings[0].evidence.linkTarget).toBe('[redacted:absolute-path]');
    expect(JSON.stringify(rs)).not.toContain('/etc/passwd');
  });
  it('unreadable directories yield REVIEW_PENDING, not STALE', () => {
    const r = resolveLinkTarget({
      docDir: '/nonexistent-dir-xyz',
      target: 'ghost.md',
      readDir: () => null,
    });
    expect(r.kind).toBe('unresolved');
    expect(r.note).toBe('directory-unreadable');
  });
  it('REVIEW_PENDING-only findings yield a REVIEW_PENDING summary, not STALE', () => {
    const root = makeRoot();
    const rs = checkDocLinks({
      docRepoPath: 'a.md',
      markdown: '# A\n\nSee [x](Guide.MD).\n',
      docDir: root,
      readDir: () => ['guide.md', 'GUIDE.md'],
    });
    expect(rs.find((r) => r.check === 'C3.links-summary').state).toBe(STATES.REVIEW_PENDING);
  });
});

describe('report sanitization', () => {
  it('mdCell escapes pipes and newlines', () => {
    expect(mdCell('a|b\nc')).toBe('a\\|b c');
  });
  it('formatMarkdownSummary keeps tables intact on hostile values', () => {
    const report = {
      asOf: '2026-09-28T00:00:00.000Z',
      repoHead: 'abc',
      results: [
        { check: 'C3.link', target: 'a|b.md', state: 'STALE', evidence: { note: 'x\ny' } },
      ],
    };
    const row = formatMarkdownSummary(report)
      .split('\n')
      .find((l) => l.startsWith('| C3'));
    expect(row).toBe('| C3.link | a\\|b.md | STALE | {"note":"x\\ny"} |');
  });
  it('reportableTarget redacts absolute paths', () => {
    expect(reportableTarget('/etc/passwd')).toBe('[redacted:absolute-path]');
    expect(reportableTarget('docs/a.md')).toBe('docs/a.md');
  });
});
describe('C3 link checks', () => {
  it('STALE on a broken link with sanitized target and line evidence', () => {
    const root = makeRoot();
    writeDoc(root, 'docs/b.md', '# b');
    const md = '# a\n\nSee [ghost](ghost.md?token=abc#frag).\n';
    const rs = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: md,
      docDir: join(root, 'docs'),
    });
    const stale = rs.filter((r) => r.state === STATES.STALE && r.check === 'C3.link');
    expect(stale).toHaveLength(1);
    expect(stale[0].evidence.line).toBe(3);
    expect(stale[0].evidence.linkTarget).toBe('ghost.md');
  });
  it('CURRENT summary for a valid sibling bare-filename link (no false positive)', () => {
    const root = makeRoot();
    writeDoc(root, 'docs/b.md', '# b');
    const rs = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: '# a\n\nSee [b](b.md).\n',
      docDir: join(root, 'docs'),
    });
    expect(rs.filter((r) => r.check === 'C3.link')).toHaveLength(0);
    const summary = rs.find((r) => r.check === 'C3.links-summary');
    expect(summary.state).toBe(STATES.CURRENT);
  });
  it('validates same-document anchors', () => {
    const root = makeRoot();
    const good = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: '# Hello World\n\nJump [up](#hello-world).\n',
      docDir: join(root, 'docs'),
    });
    expect(good.filter((r) => r.check === 'C3.link')).toHaveLength(0);
    const bad = checkDocLinks({
      docRepoPath: 'docs/a.md',
      markdown: '# Hello World\n\nJump [up](#nope).\n',
      docDir: join(root, 'docs'),
    });
    const stale = bad.filter((r) => r.check === 'C3.link');
    expect(stale).toHaveLength(1);
    expect(stale[0].evidence.reason).toBe('anchor-absent');
  });
});

describe('C4 review age', () => {
  it('UNKNOWN on malformed or missing stamps', () => {
    const r = checkDocAge({ docRepoPath: 'x.md', markdown: '# T\n', asOf: AS_OF });
    expect(r.state).toBe(STATES.UNKNOWN);
  });
  it('REVIEW_PENDING on old stamps', () => {
    const r = checkDocAge({
      docRepoPath: 'x.md',
      markdown: '# T\n\nLast Updated: 2020-06-01\n',
      asOf: AS_OF,
    });
    expect(r.state).toBe(STATES.REVIEW_PENDING);
  });
});

describe('runDriftCheck determinism (W3 no-change / retry)', () => {
  function fixture() {
    const root = makeRoot();
    writeDoc(root, 'docs/a.md', '# A\n\nLast Updated: 2026-09-20\n\nSee [b](b.md).\n');
    writeDoc(root, 'docs/b.md', '# B\n');
    writeDoc(
      root,
      'engineering-brain/index-manifest.json',
      JSON.stringify({ commit_sha: 'a'.repeat(40) }),
    );
    return root;
  }
  it('produces byte-identical JSON and Markdown on retry with the same --as-of', () => {
    const root = fixture();
    const opts = { root, asOf: AS_OF, git: fakeGit('a'.repeat(40)) };
    const first = runDriftCheck(opts);
    const second = runDriftCheck(opts);
    expect(JSON.stringify(first.report)).toBe(JSON.stringify(second.report));
    expect(first.summary).toBe(second.summary);
  });
  it('report contains repo-relative paths only', () => {
    const root = fixture();
    const { report } = runDriftCheck({ root, asOf: AS_OF, git: fakeGit('a'.repeat(40)) });
    const raw = JSON.stringify(report);
    expect(raw).not.toContain(root);
    for (const r of report.results) {
      expect(r.target.startsWith('/')).toBe(false);
    }
  });
});

describe('defaultGit integration', () => {
  it('reads a real repository', () => {
    const root = makeRoot();
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'config', 'user.email', 't@t.t']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 't']);
    writeFileSync(join(root, 'f.txt'), 'x');
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'one']);
    const git = defaultGit(root);
    const head = git.headSha();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(git.objectExists(head)).toBe(true);
    expect(git.objectExists('0'.repeat(40))).toBe(false);
    expect(git.isAncestor(head, head)).toBe(true);
    expect(git.commitsBetween(head, head)).toBe(0);
  });
});

describe('CLI end to end', () => {
  function cliRoot({ brokenLink = false, ambiguousLink = false } = {}) {
    const root = makeRoot();
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'config', 'user.email', 't@t.t']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 't']);
    writeDoc(root, 'docs/b.md', '# B\n');
    let aMd;
    if (brokenLink) {
      aMd = '# A\n\n[ghost](ghost.md).\n';
    } else if (ambiguousLink) {
      writeDoc(root, 'docs/guide.md', '# G\n');
      writeDoc(root, 'docs/GUIDE.md', '# G2\n');
      aMd = '# A\n\nSee [x](Guide.MD).\n';
    } else {
      aMd = '# A\n\nSee [b](b.md).\n';
    }
    writeDoc(root, 'docs/a.md', aMd);
    writeDoc(root, 'engineering-brain/index-manifest.json', JSON.stringify({ commit_sha: 'pending' }));
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, 'commit', '-qm', 'one']);
    const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(root, 'engineering-brain/index-manifest.json'),
      JSON.stringify({ commit_sha: head }),
    );
    return root;
  }
  function runCliRaw(args) {
    try {
      const stdout = execFileSync('node', [SCRIPT, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '' };
    } catch (err) {
      return {
        code: err.status,
        stdout: String(err.stdout || ''),
        stderr: String(err.stderr || ''),
      };
    }
  }
  const asOfArgs = (root) => ['--root', root, '--as-of', '2026-09-28T12:00:00Z'];
  it('exits 0 with deterministic stdout when clean', () => {
    const root = cliRoot();
    const first = runCliRaw(asOfArgs(root));
    const second = runCliRaw(asOfArgs(root));
    expect(first.code).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(JSON.parse(first.stdout).results.length).toBeGreaterThan(0);
  });
  it('exits 1 when a STALE link exists', () => {
    const root = cliRoot({ brokenLink: true });
    const r = runCliRaw(asOfArgs(root));
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    const stale = report.results.filter((x) => x.state === 'STALE');
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0].evidence.linkTarget).toBe('ghost.md');
  });
  it('exits 0 when findings are REVIEW_PENDING-only', () => {
    const root = cliRoot({ ambiguousLink: true });
    const r = runCliRaw(asOfArgs(root));
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.results.some((x) => x.state === 'STALE')).toBe(false);
    expect(report.results.some((x) => x.state === 'REVIEW_PENDING')).toBe(true);
  });
  it('exits 2 on a bad --as-of', () => {
    const r = runCliRaw(['--root', cliRoot(), '--as-of', 'not-a-date']);
    expect(r.code).toBe(2);
  });
  it('does not echo unknown argument values', () => {
    const r = runCliRaw(['--bogus-flag', 'supersecret123']);
    expect(r.code).toBe(2);
    expect(r.stderr).not.toContain('supersecret123');
  });
});
