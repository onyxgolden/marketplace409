// run-manual.js — host launcher: reads a fixture, runs the agent, prints JSON.
import { readFileSync } from 'node:fs';
import { run } from '../src/index.js';

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
console.log(JSON.stringify(run(task, ctx), null, 2));
