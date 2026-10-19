// run-with-watchdog.js — PM651-009 external watchdog.
// Runs the full run() admission/resolution/execution path in a child process
// with a 5-second timeout. On timeout: kills the child, emits a bounded
// REFUSED/TIMEOUT envelope. Boot/import failures are reported as
// BOOT_FAILURE (not TIMEOUT). Builtins only.
//
// PM651-009 fixes:
// - Worker uses ABSOLUTE file:// URLs (not relative imports resolved from
//   the /tmp worker file location).
// - Boot/import/worker failure is distinct from genuine TIMEOUT.
// - Temporary input files are cleaned up.
// - Trust bootstrap is verified before the worker runs.
//
// Usage: node run-with-watchdog.js <task.json> <context.json>
//   Reads task and context from JSON files, enforces the timeout, prints
//   the envelope JSON to stdout. Exit 0 on success (even for REFUSED
//   envelopes); exit 1 on usage error; exit 2 on trust failure.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 256 * 1024;

// Absolute file URLs for the worker (PM651-009: no relative imports).
const BOOTSTRAP_URL = pathToFileURL(join(ROOT, 'corpus', 'trust-bootstrap.js')).href;
const INDEX_URL = pathToFileURL(join(ROOT, 'src', 'index.js')).href;

function baseEnvelope(taskId, code, reason) {
  const env = {
    schema_version: '1',
    agent: 'project-manager',
    task_id: typeof taskId === 'string' && taskId.length <= 1024 ? taskId : '[inadmissible-id]',
    status: 'REFUSED',
    advisory: true, fixture_only: true, authorization_granted: false,
    complete: false, source_refs: [], diagnostics: [],
    quarantined_sources: [], routing_flags: [], report: null,
  };
  env.diagnostics.push({ code, severity: 'high', record_id: null, source_ref: null, reason });
  return env;
}

function timeoutEnvelope(taskId) {
  return baseEnvelope(taskId, 'TIMEOUT',
    `run() exceeded ${TIMEOUT_MS}ms watchdog; worker terminated`);
}

function bootFailureEnvelope(taskId, detail) {
  return baseEnvelope(taskId, 'BOOT_FAILURE',
    `worker failed before agent execution: ${String(detail).slice(0, 200)}`);
}

async function main() {
  const [, , taskPath, contextPath] = process.argv;
  if (!taskPath || !contextPath) {
    console.error('Usage: node run-with-watchdog.js <task.json> <context.json>');
    process.exit(1);
  }

  // Bound input I/O before supervision (PM651-009).
  let taskRaw, contextRaw;
  try {
    taskRaw = readFileSync(resolve(taskPath), 'utf8');
    contextRaw = readFileSync(resolve(contextPath), 'utf8');
  } catch (e) {
    console.log(JSON.stringify(bootFailureEnvelope(null, `cannot read input: ${e.message}`)));
    return;
  }
  if (Buffer.byteLength(taskRaw, 'utf8') > MAX_INPUT_BYTES ||
      Buffer.byteLength(contextRaw, 'utf8') > MAX_INPUT_BYTES) {
    console.log(JSON.stringify(bootFailureEnvelope(null, 'input exceeds 256KiB')));
    return;
  }
  let task, context;
  try {
    task = JSON.parse(taskRaw);
    context = JSON.parse(contextRaw);
  } catch (e) {
    console.log(JSON.stringify(bootFailureEnvelope(null, `input is not JSON: ${e.message}`)));
    return;
  }
  const taskId = task && typeof task.task_id === 'string' ? task.task_id : null;

  // Verify trust BEFORE spawning the worker (PM651-008/009).
  const { verify } = await import(BOOTSTRAP_URL);
  try {
    verify();
  } catch (e) {
    console.error(`TRUST-BOOTSTRAP FAILED: ${e.message}`);
    process.exit(2);
  }

  // Write inputs to temp files for the worker.
  const dir = mkdtempSync(join(tmpdir(), 'pm-watchdog-'));
  const taskFile = join(dir, 'task.json');
  const ctxFile = join(dir, 'context.json');
  const workerFile = join(dir, 'worker.mjs');
  try {
    writeFileSync(taskFile, taskRaw);
    writeFileSync(ctxFile, contextRaw);

    // Worker: absolute file URLs (PM651-009). No relative imports.
    const workerCode = `
import { verify } from ${JSON.stringify(BOOTSTRAP_URL)};
verify();
const { run } = await import(${JSON.stringify(INDEX_URL)});
const { readFileSync } = await import('node:fs');
const task = JSON.parse(readFileSync(${JSON.stringify(taskFile)}, 'utf8'));
const context = JSON.parse(readFileSync(${JSON.stringify(ctxFile)}, 'utf8'));
const result = run(task, context);
console.log(JSON.stringify(result));
`;
    writeFileSync(workerFile, workerCode);

    await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [workerFile], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputTooLarge = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, TIMEOUT_MS);

      child.stdout.on('data', (d) => {
        stdout += d.toString('utf8');
        if (stdout.length > MAX_OUTPUT_BYTES && !outputTooLarge) {
          outputTooLarge = true;
          child.kill('SIGKILL');
        }
      });
      child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          // Genuine timeout: the 5s timer fired.
          console.log(JSON.stringify(timeoutEnvelope(taskId)));
        } else if (outputTooLarge) {
          console.log(JSON.stringify(baseEnvelope(taskId, 'OUTPUT_LIMIT', 'worker output exceeds 256KiB')));
        } else if (signal === 'SIGKILL') {
          // Killed but not by our timer (shouldn't happen).
          console.log(JSON.stringify(bootFailureEnvelope(taskId, `worker killed by signal ${signal}`)));
        } else if (code !== 0) {
          // Boot/import failure: distinguish from TIMEOUT (PM651-009).
          const errText = stderr.slice(0, 500);
          if (errText.includes('ERR_MODULE_NOT_FOUND') || errText.includes('Cannot find module')) {
            console.log(JSON.stringify(bootFailureEnvelope(taskId, `module not found: ${errText.slice(0, 200)}`)));
          } else if (errText.includes('TRUST-BOOTSTRAP FAILED')) {
            console.log(JSON.stringify(bootFailureEnvelope(taskId, 'trust bootstrap failed in worker')));
          } else {
            console.log(JSON.stringify(bootFailureEnvelope(taskId, `worker exited ${code}: ${errText.slice(0, 200)}`)));
          }
        } else {
          // Success: bound the output.
          const out = stdout.trim();
          if (Buffer.byteLength(out, 'utf8') > MAX_OUTPUT_BYTES) {
            console.log(JSON.stringify(baseEnvelope(taskId, 'OUTPUT_LIMIT', 'output exceeds 256KiB')));
          } else {
            console.log(out);
          }
        }
        resolvePromise();
      });

      child.on('error', (e) => {
        clearTimeout(timer);
        console.log(JSON.stringify(bootFailureEnvelope(taskId, `worker spawn failed: ${e.message}`)));
        resolvePromise();
      });
    });
  } finally {
    // Clean up temporary input files (PM651-009).
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main();
