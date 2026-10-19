/**
 * hang-worker.js — manifest-authenticated worker that NEVER settles.
 *
 * S653-008: hang tests must use fixed, independently authenticated test
 * workers — never eval, never executable factories. This file is pinned
 * in corpus/manifest.json and authenticated by bootstrap.mjs before any
 * test runs. It simulates a hung public task so the external 5-second
 * watchdog's termination path is exercised for real.
 */

import { parentPort } from "node:worker_threads";

// Never posts, never exits on its own. The parent's watchdog terminates it.
setInterval(() => {}, 60000);
void parentPort;
