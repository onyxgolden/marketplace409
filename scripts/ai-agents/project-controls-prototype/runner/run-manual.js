// run-manual.js — manual host launcher. Reads a task JSON file, resolves
// fixtures from fixtures/store.json, prints canonical JSON to stdout.
// PC650-007: routes through the external 5s watchdog (run-guarded.js).
// Usage: node runner/run-manual.js <task.json> [--scratch <dir>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuarded } from './run-guarded.js';
import { canonicalStringify } from '../src/canonical.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('usage: node runner/run-manual.js <task.json> [--scratch <dir>]');
  process.exit(2);
}
const taskPath = args[0];
const scratchIdx = args.indexOf('--scratch');
const scratch = scratchIdx >= 0 ? args[scratchIdx + 1] : null;

const task = JSON.parse(readFileSync(taskPath, 'utf8'));
const store = JSON.parse(readFileSync(join(root, 'fixtures', 'store.json'), 'utf8'));
const context = {
  clock: { now: new Date().toISOString().replace(/\.\d+Z$/, 'Z') },
  criteria_version: 'controls-v1',
  principal: { id: 'manual-host' },
  grants: [],
  request_authority: 'muse-relay',
  fixtureStore: store,
};

// PC650-007: all execution goes through the external watchdog.
const out = await runGuarded(task, context);
const text = canonicalStringify(out);
if (scratch) {
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, `report-${task.task_id || 'manual'}.json`), text + '\n');
}
process.stdout.write(text + '\n');
