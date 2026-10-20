#!/usr/bin/env node
/**
 * timeout-hang-worker.js — FIXED fixture worker for timeout probes
 * (test-only). Blocks forever on purpose so the parent watchdog's
 * 5-second timer can be observed terminating it. Never used in the
 * production path.
 */

import { parentPort } from "node:worker_threads";

parentPort.postMessage({ ok: true, result: "hanging" });
// Hang forever: the parent watchdog must terminate us.
setInterval(() => {}, 1000000);
