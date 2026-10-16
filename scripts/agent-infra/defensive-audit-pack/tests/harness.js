/**
 * harness.js — minimal deterministic test harness (no dependencies).
 * Original code.
 */

const tests = [];
let onlyFilter = null;

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`assertEqual failed: ${msg}\n  actual:   ${a}\n  expected: ${e}`);
}

export function assertThrows(fn, part, msg) {
  try {
    fn();
  } catch (e) {
    if (part && !String(e.message).includes(part)) {
      throw new Error(`assertThrows wrong message: ${msg}\n  got: ${e.message}\n  want substring: ${part}`);
    }
    return e;
  }
  throw new Error(`assertThrows did not throw: ${msg}`);
}

export async function runAll() {
  let pass = 0;
  const failures = [];
  for (const t of tests) {
    if (onlyFilter && !t.name.includes(onlyFilter)) continue;
    const start = Date.now();
    try {
      await t.fn();
      pass++;
    } catch (e) {
      failures.push({ name: t.name, error: e });
    }
    if (Date.now() - start > 5000) {
      failures.push({ name: t.name, error: new Error("test exceeded 5s") });
    }
  }
  return { pass, fail: failures.length, failures, total: tests.length };
}

export function printResults(res) {
  console.log(`tests: ${res.pass}/${res.total} pass`);
  for (const f of res.failures) {
    console.log(`FAIL ${f.name}\n  ${String(f.error && f.error.stack || f.error).split("\n").slice(0, 4).join("\n  ")}`);
  }
  return res.fail === 0 ? 0 : 1;
}
