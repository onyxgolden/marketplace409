// run-manual.js — host launcher: reads a fixture, runs the agent via the
// external watchdog, prints JSON. PM651-009: the official manual execution
// path is supervised by the 5-second watchdog (run-with-watchdog.js), not a
// raw synchronous run().
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixtureId = process.argv[2] || 'plan-linear';
const store = JSON.parse(readFileSync(new URL('../fixtures/store.json', import.meta.url), 'utf8')).fixtures;
const ctx = {
  clock: {}, criteria_version: '1',
  principal: { principal_id: 'jason', kind: 'human' },
  grants: [{ grant_id: 'g1', principal_id: 'jason', action: 'read', resource: { fixture_id: '*' } }],
  request_authority: 'jason', relay: null, fixtureStore: store,
};
const task = {
  schema_version: '1', task_id: `manual-${Date.now()}`,
  operation: 'analyze', fixture_refs: [fixtureId],
  options: { include_draft_summary: true },
};

// PM651-009: route through the guarded host. Write task/context to temp
// files, invoke the watchdog, print its envelope.
const dir = mkdtempSync(join(tmpdir(), 'pm-manual-'));
try {
  const taskFile = join(dir, 'task.json');
  const ctxFile = join(dir, 'context.json');
  writeFileSync(taskFile, JSON.stringify(task));
  writeFileSync(ctxFile, JSON.stringify(ctx));
  const watchdog = new URL('./run-with-watchdog.js', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [watchdog, taskFile, ctxFile], {
    encoding: 'utf8', timeout: 15000,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.status ?? 0);
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}
