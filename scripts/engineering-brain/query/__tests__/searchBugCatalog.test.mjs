import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenize, scoreRecord, searchBugCatalog } from '../searchBugCatalog.mjs';
import { loadBugCatalogRecords } from '../queryEngineeringBrainCli.mjs';

const rec = (overrides) => ({
  sha: 'abc123',
  date: '2026-09-26T10:00:00+00:00',
  subject: 'fix: something',
  pr: null,
  class: 'fix',
  files: [],
  ...overrides,
});

describe('tokenize', () => {
  it('lowercases, splits, drops short tokens and stopwords', () => {
    expect(tokenize('Fix the NULL pointer!')).toEqual(['null', 'pointer']);
    expect(tokenize('a an the of to')).toEqual([]);
    expect(tokenize('overlay show() race')).toEqual(['overlay', 'show', 'race']);
  });
});

describe('scoreRecord', () => {
  it('weighs subject terms double and file terms single', () => {
    const r = rec({ subject: 'fix: null pointer in ledger', files: ['src/ledger/totals.js'] });
    expect(scoreRecord(r, ['null', 'pointer']).score).toBe(4);
    expect(scoreRecord(r, ['ledger']).score).toBe(3); // subject 2 + file 1
    expect(scoreRecord(r, ['totals']).score).toBe(1);
    expect(scoreRecord(r, ['unrelated']).score).toBe(0);
  });
  it('reports matched terms', () => {
    const r = rec({ subject: 'fix: overlay race on show', files: [] });
    expect(scoreRecord(r, ['overlay', 'missing']).matchedTerms).toEqual(['overlay']);
  });
});

describe('searchBugCatalog', () => {
  const records = [
    rec({ sha: 'aaa', date: '2026-09-20T10:00:00+00:00', subject: 'fix: overlay retry race on show', files: ['src/capture/overlay.js'] }),
    rec({ sha: 'bbb', date: '2026-09-26T10:00:00+00:00', subject: 'fix: null pointer in ledger totals', files: ['src/ledger/totals.js'] }),
    rec({ sha: 'ccc', date: '2026-09-25T10:00:00+00:00', subject: 'fix: overlay crash on hide', files: ['src/capture/overlay.js'] }),
  ];

  it('ranks by score, breaking ties by recency', () => {
    const hits = searchBugCatalog({ records, queryText: 'overlay show race' });
    expect(hits.map((h) => h.record.sha)).toEqual(['aaa', 'ccc']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('returns nothing for empty or stopword-only queries', () => {
    expect(searchBugCatalog({ records, queryText: '' })).toEqual([]);
    expect(searchBugCatalog({ records, queryText: 'how to fix the bug' })).toEqual([]);
  });

  it('caps results and is deterministic', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      rec({ sha: `s${i}`, date: '2026-09-26T10:00:00+00:00', subject: 'fix: overlay thing', files: [] }),
    );
    const a = searchBugCatalog({ records: many, queryText: 'overlay', maxResults: 5 });
    const b = searchBugCatalog({ records: many, queryText: 'overlay', maxResults: 5 });
    expect(a).toHaveLength(5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('handles missing records gracefully', () => {
    expect(searchBugCatalog({ records: null, queryText: 'overlay' })).toEqual([]);
  });
});

describe('loadBugCatalogRecords', () => {
  it('loads records next to the manifest and tolerates absence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bugcli-'));
    const manifestPath = join(dir, 'index-manifest.json');
    writeFileSync(manifestPath, '{}', 'utf8');
    expect(loadBugCatalogRecords({ manifestPath })).toEqual([]);

    writeFileSync(join(dir, 'bug-catalog.json'), JSON.stringify({ records: [rec()] }), 'utf8');
    expect(loadBugCatalogRecords({ manifestPath })).toHaveLength(1);

    writeFileSync(join(dir, 'bug-catalog.json'), 'not json', 'utf8');
    expect(loadBugCatalogRecords({ manifestPath })).toEqual([]);
  });

  it('honors an explicit path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bugcli2-'));
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const custom = join(dir, 'sub', 'custom.json');
    writeFileSync(custom, JSON.stringify({ records: [rec(), rec()] }), 'utf8');
    expect(loadBugCatalogRecords({ manifestPath: join(dir, 'index-manifest.json'), bugCatalogPath: custom })).toHaveLength(2);
  });
});
