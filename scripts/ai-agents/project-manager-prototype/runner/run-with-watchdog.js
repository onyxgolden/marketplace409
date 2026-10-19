// run-with-watchdog.js — PM651-009 external watchdog.
// Runs the full run() path in a worker process with a 5-second timeout.
// On timeout: kills the worker, emits a bounded REFUSED/TIMEOUT envelope
// with complete:false. Builtins only.
//
// Usage: node run-with-watchdog.js <task.json> <context.json>
//   Reads task and context from JSON files, runs via trust-bootstrap,
//   enforces the timeout, prints the envelope JSON to stdout.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 256 * 1024;

function timeoutEnvelope(taskId) {
  const env = {
    schema_version: '1',
    agent: 'project-manager',
    task_id: typeof taskId === 'string' && taskId.length <= 1024 ? taskId : '[inadmissible-id]',
    status: 'REFUSED',
    advisory: true, fixture_only: true, authorization_granted: false,
    complete: false, source_refs: [], diagnostics: [],
    quarantined_sources: [], routing_flags: [], report: null,
  };
  env.diagnostics.push({
    code: 'TIMEOUT', severity: 'high', record_id: null, source_ref: null,
    reason: `run() exceeded ${TIMEOUT_MS}ms watchdog; worker terminated`,
  });
  return env;
}

async function main() {
  const [, , taskPath, contextPath] = process.argv;
  if (!taskPath || !contextPath) {
    console.error('Usage: node run-with-watchdog.js <task.json> <context.json>');
    process.exit(1);
  }

  const task = JSON.parse(readFileSync(resolve(taskPath), 'utf8'));
  const context = JSON.parse(readFileSync(resolve(contextPath), 'utf8'));
  const taskId = task && typeof task.task_id === 'string' ? task.task_id : null;

  // Write inputs to temp files for the worker.
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'pm-watchdog-'));
  const taskFile = join(dir, 'task.json');
  const ctxFile = join(dir, 'context.json');
  writeFileSync(taskFile, JSON.stringify(task));
  writeFileSync(ctxFile, JSON.stringify(context));

  // Worker script: verifies trust, then runs.
  const workerCode = `
    import { verify } from './corpus/trust-bootstrap.js';
    verify();
    const { run } = await import('./src/index.js');
    const { readFileSync } = await import('node:fs');
    const task = JSON.parse(readFileSync(${JSON.stringify(taskFile)}, 'utf8'));
    const context = JSON.parse(readFileSync(${JSON.stringify(ctxFile)}, 'utf8'));
    const result = run(task, context);
    console.log(JSON.stringify(result));
  `;
  const workerFile = join(dir, 'worker.mjs');
  writeFileSync(workerFile, workerCode);

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [workerFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut || signal === 'SIGKILL') {
        console.log(JSON.stringify(timeoutEnvelope(taskId)));
        resolvePromise();
        return;
      }
      if (code !== 0) {
        console.error(`worker exited ${code}: ${stderr.slice(0, 500)}`);
        console.log(JSON.stringify(timeoutEnvelope(taskId)));
        resolvePromise();
        return;
      }
      // Bound the output.
      const out = stdout.trim();
      if (Buffer.byteLength(out, 'utf8') > MAX_OUTPUT_BYTES) {
        console.log(JSON.stringify(timeoutEnvelope(taskId)));
      } else {
        console.log(out);
      }
      resolvePromise();
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      console.error(`worker spawn failed: ${e.message}`);
      console.log(JSON.stringify(timeoutEnvelope(taskId)));
      resolvePromise();
    });
  });
}

main();
