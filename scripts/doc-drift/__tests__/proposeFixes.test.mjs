import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  levenshtein,
  rewriteLineTarget,
  findDefinitionLine,
  escapeRegExp,
  countIdUsages,
  indexMarkdownByBasename,
  adaptFinding,
  proposeForFinding,
  runProposer,
  formatMarkdownProposals,
  mdCell,
} from '../proposeFixes.mjs';
import { STATES } from '../checkDocDrift.mjs';

function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'propose-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return root;
}

function ctx(root, docs) {
  const readDoc = (p) => (p in docs ? docs[p] : null);
  return {
    root,
    readDoc,
    basenameIndex: indexMarkdownByBasename(root),
    targetHeadingsCache: new Map(),
  };
}

/** A real Phase-1 C3.link STALE result. */
const phase1Link = (file, line, linkTarget, reason) => ({
  check: 'C3.link',
  target: file,
  state: STATES.STALE,
  evidence: { line, linkTarget, reason },
});

describe('levenshtein', () => {
  it('computes classic distances', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('a', '')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('setup-guide', 'setup-guide')).toBe(0);
    expect(levenshtein('setup-guide', 'setup-guid')).toBe(1);
  });
});

describe('rewriteLineTarget', () => {
  it('replaces the first occurrence of the target', () => {
    expect(rewriteLineTarget('see [x](old/missing.md) and old/missing.md', 'old/missing.md', 'new/found.md')).toBe(
      'see [x](new/found.md) and old/missing.md',
    );
  });
  it('returns null when the target is absent', () => {
    expect(rewriteLineTarget('no link here', 'old/missing.md', 'new/found.md')).toBeNull();
  });
});

describe('findDefinitionLine', () => {
  it('finds definitions case-insensitively and misses cleanly', () => {
    const md = '# T\n\n[Alpha]: ./a.md\n\n[beta]: ./b.md\n';
    expect(findDefinitionLine(md, 'alpha')).toBe(3);
    expect(findDefinitionLine(md, 'BETA')).toBe(5);
    expect(findDefinitionLine(md, 'gamma')).toBe(-1);
  });
});

describe('escapeRegExp / countIdUsages', () => {
  it('counts [text][id] usages case-insensitively', () => {
    const md = 'see [a][Guid] and [b][GUID] and [c][other]\n';
    expect(countIdUsages(md, 'guid')).toBe(2);
    expect(countIdUsages(md, 'other')).toBe(1);
    expect(countIdUsages(md, 'missing')).toBe(0);
    expect(escapeRegExp('a.b[c]')).toBe('a\\.b\\[c\\]');
  });
});

describe('indexMarkdownByBasename', () => {
  it('indexes case-insensitively and skips .git', () => {
    const root = makeRepo({
      'docs/Guide.md': '# g',
      'other/guide.md': '# g2',
      '.git/objects/guide.md': '# hidden',
    });
    const idx = indexMarkdownByBasename(root);
    expect(idx.get('guide.md').sort()).toEqual(['docs/Guide.md', 'other/guide.md']);
  });
});

describe('adaptFinding', () => {
  it('adapts a real C3.link STALE result', () => {
    expect(adaptFinding(phase1Link('docs/a.md', 3, 'old/missing.md', 'target-absent'))).toEqual({
      file: 'docs/a.md',
      line: 3,
      linkTarget: 'old/missing.md',
      reason: 'target-absent',
    });
  });
  it('rejects non-link checks, non-STALE states, and malformed evidence', () => {
    expect(adaptFinding({ check: 'C3.links-summary', target: 'docs/a.md', state: STATES.STALE, evidence: {} })).toBeNull();
    expect(
      adaptFinding({ check: 'C3.link', target: 'docs/a.md', state: STATES.CURRENT, evidence: { line: 1, linkTarget: 'x', reason: 'r' } }),
    ).toBeNull();
    expect(adaptFinding({ check: 'C3.link', target: 'docs/a.md', state: STATES.STALE, evidence: { line: '3', linkTarget: 'x', reason: 'r' } })).toBeNull();
    expect(adaptFinding(null)).toBeNull();
  });
});

describe('proposeForFinding — target-absent (inline)', () => {
  it('proposes a high-confidence edit when exactly one same-basename file exists', () => {
    const root = makeRepo({ 'new/missing.md': '# moved here' });
    const docs = { 'docs/a.md': 'intro\n\nsee [the doc](old/missing.md) for details\n' };
    const [p] = proposeForFinding({ ...ctx(root, docs), finding: adaptFinding(phase1Link('docs/a.md', 3, 'old/missing.md', 'target-absent')) });
    expect(p.confidence).toBe('high');
    expect(p.edit.line).toBe(3);
    expect(p.edit.newText).toContain('../new/missing.md');
    expect(p.edit.oldText).toContain('old/missing.md');
    expect(p.sources.some((s) => s.type === 'repo-file' && s.path === 'new/missing.md')).toBe(true);
  });

  it('asks the owner to choose when several candidates exist', () => {
    const root = makeRepo({ 'n1/missing.md': '# 1', 'n2/missing.md': '# 2' });
    const docs = { 'docs/a.md': 'a\nb\nsee [x](old/missing.md)\n' };
    const [p] = proposeForFinding({ ...ctx(root, docs), finding: adaptFinding(phase1Link('docs/a.md', 3, 'old/missing.md', 'target-absent')) });
    expect(p.confidence).toBe('medium');
    expect(p.edit).toBeNull();
    expect(p.sources.filter((s) => s.type === 'repo-file')).toHaveLength(2);
  });

  it('records low confidence with no candidates', () => {
    const root = makeRepo({});
    const docs = { 'docs/a.md': 'a\nb\nsee [x](old/missing.md)\n' };
    const [p] = proposeForFinding({ ...ctx(root, docs), finding: adaptFinding(phase1Link('docs/a.md', 3, 'old/missing.md', 'target-absent')) });
    expect(p.confidence).toBe('low');
    expect(p.edit).toBeNull();
  });

  it('emits nothing when the doc is unreadable', () => {
    const root = makeRepo({});
    expect(
      proposeForFinding({ ...ctx(root, {}), finding: adaptFinding(phase1Link('docs/a.md', 3, 'old/missing.md', 'target-absent')) }),
    ).toEqual([]);
  });
});

describe('proposeForFinding — target-absent (reference definition)', () => {
  it('edits the definition line, not the usage line', () => {
    const root = makeRepo({ 'new/gone.md': '# moved' });
    const docs = { 'docs/a.md': 'see [r][ref] below\n\n\n\n[ref]: ./gone.md\n' };
    const [p] = proposeForFinding({
      ...ctx(root, docs),
      finding: adaptFinding(phase1Link('docs/a.md', 1, './gone.md', 'target-absent')),
    });
    expect(p.confidence).toBe('high');
    expect(p.edit.line).toBe(5);
    expect(p.edit.oldText).toBe('[ref]: ./gone.md');
    expect(p.edit.newText).toBe('[ref]: ../new/gone.md');
  });
});

describe('proposeForFinding — anchor-absent', () => {
  it('recovers the fragment and proposes a high-confidence anchor fix', () => {
    const root = makeRepo({});
    const docs = {
      'docs/a.md': 'a\nb\nsee [x](b.md#setup-guid)\n',
      'docs/b.md': '# Setup Guide\n',
    };
    const [p] = proposeForFinding({
      ...ctx(root, docs),
      finding: adaptFinding(phase1Link('docs/a.md', 3, 'b.md', 'anchor-absent')),
    });
    expect(p.confidence).toBe('high');
    expect(p.edit.newText).toContain('b.md#setup-guide');
    expect(p.edit.oldText).toContain('b.md#setup-guid');
  });

  it('handles same-document anchors', () => {
    const root = makeRepo({});
    const docs = { 'docs/a.md': '# Setup Guide\n\nsee [x](#setup-guid)\n' };
    const [p] = proposeForFinding({
      ...ctx(root, docs),
      finding: adaptFinding(phase1Link('docs/a.md', 3, '', 'anchor-absent')),
    });
    expect(p.confidence).toBe('high');
    expect(p.edit.newText).toContain('#setup-guide');
  });

  it('records low confidence when no similar heading exists', () => {
    const root = makeRepo({});
    const docs = {
      'docs/a.md': 'a\nb\nsee [x](b.md#totally-different)\n',
      'docs/b.md': '# Something Else\n',
    };
    const [p] = proposeForFinding({
      ...ctx(root, docs),
      finding: adaptFinding(phase1Link('docs/a.md', 3, 'b.md', 'anchor-absent')),
    });
    expect(p.confidence).toBe('low');
    expect(p.edit).toBeNull();
  });
});

describe('proposeForFinding — reference-undefined', () => {
  it('proposes a medium-confidence usage fix when the definition is not load-bearing', () => {
    const root = makeRepo({});
    const docs = { 'docs/a.md': 'see [the guide][guide] for more\n\n[guid]: ./guide.md\n' };
    const [p] = proposeForFinding({
      ...ctx(root, docs),
      finding: adaptFinding(phase1Link('docs/a.md', 1, '', 'reference-undefined')),
    });
    expect(p.confidence).toBe('medium');
    expect(p.edit.line).toBe(1);
    expect(p.edit.newText).toBe('see [the guide][guid] for more');
    expect(p.confidenceReasons.join(' ')).toContain('may instead be the typo');
  });

  it('proposes a high-confidence usage fix when the definition is load-bearing', () => {
    const root = makeRepo({});
    const docs = { 'docs/a.md': 'see [the guide][guide] for more\n\n[guid]: ./guide.md\n\nalso [other][guid]\n' };
    const [p] = proposeForFinding({
      ...ctx(root, docs),
      finding: adaptFinding(phase1Link('docs/a.md', 1, '', 'reference-undefined')),
    });
    expect(p.confidence).toBe('high');
    expect(p.edit.newText).toBe('see [the guide][guid] for more');
  });

  it('records low confidence when no near-match definition exists', () => {
    const root = makeRepo({});
    const docs = { 'docs/a.md': 'see [the guide][nope] for more\n' };
    const [p] = proposeForFinding({
      ...ctx(root, docs),
      finding: adaptFinding(phase1Link('docs/a.md', 1, '', 'reference-undefined')),
    });
    expect(p.confidence).toBe('low');
    expect(p.edit).toBeNull();
  });
});

describe('runProposer', () => {
  it('adapts real Phase-1 results, sorts deterministically, and counts confidence', () => {
    const root = makeRepo({ 'new/missing.md': '# moved' });
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs/a.md'), 'a\nb\nsee [x](old/missing.md)\n');
    writeFileSync(join(root, 'docs/b.md'), '1\n2\n3\n4\n5\n6\n7\n8\nsee [y](elsewhere/missing.md)\n');
    const report = {
      tool: 'forge-doc-drift',
      version: '1.0.0',
      generatedAt: '2026-09-28T12:00:00.000Z',
      repoHead: 'abc123',
      results: [
        phase1Link('docs/b.md', 9, 'elsewhere/missing.md', 'target-absent'),
        phase1Link('docs/a.md', 3, 'old/missing.md', 'target-absent'),
        { check: 'C3.links-summary', target: 'docs/a.md', state: STATES.STALE, evidence: { note: 'x' } },
        { check: 'C4.review-age', target: 'docs/a.md', state: STATES.UNKNOWN, evidence: {} },
      ],
    };
    const result = runProposer({ root, report, asOf: '2026-09-28T12:00:00.000Z' });
    expect(result.findingsConsidered).toBe(2);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0].id).toBe('P-0001');
    expect(result.proposals[0].file).toBe('docs/a.md'); // sorted before docs/b.md
    expect(result.proposals[0].finding.check).toBe('C3.link');
    expect(result.proposals[1].id).toBe('P-0002');
    expect(result.proposalCounts.high).toBe(2);
    expect(result.generatedAt).toBe('2026-09-28T12:00:00.000Z');
    expect(result.driftReport.repoHead).toBe('abc123');
  });
});

describe('formatMarkdownProposals', () => {
  it('escapes pipes in table cells', () => {
    expect(mdCell('a|b')).toBe('a\\|b');
    const md = formatMarkdownProposals({
      generatedAt: 't',
      driftReport: { generatedAt: 'd', repoHead: 'abc1234567890' },
      findingsConsidered: 1,
      proposalCounts: { high: 1, medium: 0, low: 0 },
      proposals: [
        {
          id: 'P-0001',
          file: 'docs/a|b.md',
          edit: { line: 3, oldText: 'old|text', newText: 'new text' },
          finding: { reason: 'target-absent' },
          confidence: 'high',
        },
      ],
    });
    expect(md).toContain('docs/a\\|b.md');
    expect(md).toContain('nothing has been applied');
  });
});
