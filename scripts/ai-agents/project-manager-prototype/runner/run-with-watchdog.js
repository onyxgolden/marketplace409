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

import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
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

/**
 * PM651-009: bounded input read.
 * - stat() first: reject non-regular files (FIFO, socket, device, directory)
 *   WITHOUT blocking. readFileSync on a FIFO with no writer hangs forever.
 * - Check st.size against the cap BEFORE reading. This bounds the allocation.
 * - Only then readFileSync (safe: regular file, known size within limit).
 * Throws on any violation; caller emits BOOT_FAILURE.
 */
function readBoundedInput(inputPath, label) {
  const abs = resolve(inputPath);
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    throw new Error(`cannot stat ${label} input: ${e.message}`);
  }
  if (!st.isFile()) {
    throw new Error(`${label} input is not a regular file (refusing FIFO/socket/device/directory)`);
  }
  if (st.size > MAX_INPUT_BYTES) {
    throw new Error(`${label} input exceeds 256KiB (${st.size} bytes)`);
  }
  // Regular file, size within cap: safe to read.
  const raw = readFileSync(abs, 'utf8');
  // Defense-in-depth: verify the read didn't exceed the cap (TOCTOU).
  if (Buffer.byteLength(raw, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error(`${label} input exceeds 256KiB after read`);
  }
  return raw;
}

async function main() {
  const [, , taskPath, contextPath] = process.argv;
  if (!taskPath || !contextPath) {
    console.error('Usage: node run-with-watchdog.js <task.json> <context.json>');
    process.exit(1);
  }

  // PM651-009: bounded input acquisition BEFORE supervision.
  // - Reject non-regular files (FIFO, socket, device, directory) without
  //   blocking. A FIFO with no writer would hang readFileSync forever,
  //   preventing the watchdog timer from ever starting.
  // - Enforce the size cap via stat BEFORE allocating the read buffer.
  //   A size comparison after a full synchronous read is not bounded I/O.
  // PM651-009 (fourth fix round): aggregate input budget before allocation.
  // Stat BOTH files first, reject if the combined size exceeds 256KiB,
  // THEN read. Reading both fully before checking the aggregate would
  // allocate over-budget bytes pre-supervision.
  let taskRaw, contextRaw;
  try {
    const taskStat = statSync(resolve(taskPath));
    const contextStat = statSync(resolve(contextPath));
    if (!taskStat.isFile() || !contextStat.isFile()) {
      throw new Error('input is not a regular file (refusing FIFO/socket/device/directory)');
    }
    if (taskStat.size + contextStat.size > MAX_INPUT_BYTES) {
      throw new Error(`aggregate input exceeds 256KiB (${taskStat.size + contextStat.size} bytes)`);
    }
    taskRaw = readBoundedInput(taskPath, 'task');
    contextRaw = readBoundedInput(contextPath, 'context');
  } catch (e) {
    console.log(JSON.stringify(bootFailureEnvelope(null, e.message)));
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
  // PM651-008 (fix round 6): authenticate the manifest itself against the
  // host root FIRST, before trusting any entry in it. Then verify the
  // helper bytes against the authenticated manifest, before importing.
  {
    const { createHash } = await import('node:crypto');
    const hostRoot = process.env.PM_TRUST_ROOT;
    if (!hostRoot || !/^[0-9a-f]{64}$/.test(hostRoot)) {
      console.error('TRUST-BOOTSTRAP FAILED: PM_TRUST_ROOT must be a 64-hex manifest digest');
      process.exit(2);
    }
    const manifestRaw = readFileSync(join(ROOT, 'corpus', 'manifest.json'), 'utf8');
    const manifestEntries = JSON.parse(manifestRaw);
    // Authenticate the manifest BEFORE trusting any entry.
    const manifestDigest = createHash('sha256').update(JSON.stringify(manifestEntries)).digest('hex');
    if (manifestDigest !== hostRoot) {
      console.error('TRUST-BOOTSTRAP FAILED: manifest digest mismatch — refusing before any candidate code');
      process.exit(2);
    }
    // Manifest is now trusted. Verify the helper bytes before import.
    const bootstrapEntry = manifestEntries.find((e) => e.path === 'corpus/trust-bootstrap.js');
    if (!bootstrapEntry) {
      console.error('TRUST-BOOTSTRAP FAILED: bootstrap helper not pinned in manifest');
      process.exit(2);
    }
    const bootstrapBytes = readFileSync(join(ROOT, 'corpus', 'trust-bootstrap.js'));
    const bootstrapHash = createHash('sha256').update(bootstrapBytes).digest('hex');
    if (bootstrapHash !== bootstrapEntry.sha256) {
      console.error('TRUST-BOOTSTRAP FAILED: bootstrap helper hash mismatch — refusing before import');
      process.exit(2);
    }
  }
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
