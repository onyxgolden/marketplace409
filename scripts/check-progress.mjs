// Progress heartbeat for long check/verification scripts.
//
// Convention (agreed by Muse, ChatGPT, and Claude, 2026-11-20 —
// FORGE-P-20261119-MUSE-LONG-RUN-PROGRESS-HEARTBEAT): any repo
// check/verification script whose MEASURED runtime exceeds ~2 minutes
// prints timestamped progress lines to stdout — a start line naming the
// measured expected duration, a line at each real phase transition, and
// a completion line with the exit status. An agent must not kill a script
// that is within its stated window and still emitting progress.
//
// Rules the helper enforces:
// - Lines go to stdout, timestamped (ISO UTC), one per event. No fake
//   percentage progress — only real phase transitions and, while waiting
//   on a phase, a heartbeat at most once every 60 seconds.
// - While waiting on a blocking readiness probe (e.g. a fetch that may
//   stay pending for minutes during a cold compile), use
//   startWaitHeartbeat(note): a bounded 60s timer emits the heartbeat
//   independently of the probe resolving. stopWaitHeartbeat() clears it;
//   done() clears it too. The timer never resets or extends the caller's
//   independent wait timeout — it only prints.
// - The stated window comes from a MEASURED run, never a guess. The
//   caller passes the measured duration and where it was measured.
// - A heartbeat never resets an independent hard timeout, and it never
//   grants unlimited runtime: a script silent past its stated window is
//   still killable. Do not change or add any timeout when adopting this.
// - Label safety is the CALLER's responsibility: the helper prints
//   exactly the labels it is given, with no filtering. Callers must pass
//   static non-sensitive labels only — never environment values,
//   filesystem paths, tokens, or customer data. The helper itself never
//   reads process.env and never echoes child-process output.
// - Advisory discipline only, never a CI gate.
//
// Usage:
//   import { createProgress } from "./check-progress.mjs";
//   const progress = createProgress({
//     script: "my-check",
//     expected: "~10 min",
//     measured: "prior runs Nov 18, 2026, ~10 min in this VM",
//   });
//   progress.start();
//   progress.phase("dev server starting");
//   progress.phase("dev server ready");
//   progress.heartbeat("waiting for dev server"); // throttled to 1/min
//   progress.done("PASS", { exitCode: 0 });
//
//   // For a blocking readiness wait, so a heartbeat still lands while the
//   // probe itself is pending (a bare await fetch() prints nothing):
//   progress.startWaitHeartbeat("waiting for dev server");
//   try {
//     await waitForServer(); // independent timeout untouched by the timer
//   } finally {
//     progress.stopWaitHeartbeat(); // cleared on success, failure, timeout
//   }

const HEARTBEAT_MIN_MS = 60_000;

function isoNow() {
  return new Date().toISOString();
}

export function createProgress({ script, expected, measured, stream = process.stdout, now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  if (!script) throw new Error("createProgress: script name is required");
  if (!expected) throw new Error("createProgress: expected duration is required");
  const startedAt = now();
  let lastHeartbeatAt = null;
  let started = false;
  let waitTimer = null;

  function line(text) {
    stream.write(`[${isoNow()}] [progress] ${script}: ${text}\n`);
  }

  function elapsed() {
    const ms = now() - startedAt;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  function heartbeat(note) {
    if (!started) throw new Error("createProgress: start() must be called before heartbeat()");
    const t = now();
    if (lastHeartbeatAt !== null && t - lastHeartbeatAt < HEARTBEAT_MIN_MS) return;
    lastHeartbeatAt = t;
    line(note);
  }

  function stopWaitHeartbeat() {
    if (waitTimer !== null) {
      clearIntervalFn(waitTimer);
      waitTimer = null;
    }
  }

  function startWaitHeartbeat(note) {
    if (!started) throw new Error("createProgress: start() must be called before startWaitHeartbeat()");
    // Restarting replaces the timer, never duplicates it — a leaked
    // interval would keep the process alive after the script finishes.
    stopWaitHeartbeat();
    waitTimer = setIntervalFn(() => {
      heartbeat(note);
    }, HEARTBEAT_MIN_MS);
  }

  return {
    start() {
      started = true;
      line(
        `starting — expected ${expected} (measured: ${measured || "not recorded"}) — do not kill while progress lines keep coming within the window`,
      );
    },
    phase(name) {
      if (!started) throw new Error("createProgress: start() must be called before phase()");
      line(name);
    },
    heartbeat,
    startWaitHeartbeat,
    stopWaitHeartbeat,
    done(status, { exitCode = 0 } = {}) {
      // Teardown path: a wait timer left running would keep the Node
      // process alive after the script finishes. Callers also clear it
      // in a finally around their wait; this is the backstop.
      stopWaitHeartbeat();
      line(`done — ${status} in ${elapsed()} (exit ${exitCode})`);
    },
  };
}
