/**
 * timeout-hang-worker.js — FIXED timeout probe fixture (RA652-001).
 *
 * This worker hangs forever and never posts a message. It is selected
 * ONLY by the closed enum in tests/timeout-probe-host.js — a test-only
 * host outside the production API. Production code (runner/run-guarded.js)
 * can never select it: the production launcher is JSON-only and always
 * spawns the fixed guarded-worker.js.
 *
 * Pinned in corpus/manifest.json like every other shipped byte.
 */

// The worker blocks here forever. The probing host's external watchdog
// terminates it; a probe that does not settle bounded is a failure.
while (true) {
  // Intentional busy hang: proves the external watchdog terminates a
  // truly blocked worker thread. No message is ever posted.
}
