import { describe, expect, it } from "vitest";
import {
  runNightlySelfHeal,
  findPriorFixPr,
  DEFAULT_MAX_ATTEMPTS,
} from "../runNightlySelfHeal.mjs";
import { makeGithubActionsDeps } from "../githubActionsDeps.mjs";
import { parseArgs } from "../runNightlySelfHealCli.mjs";

const BASE = "abc1234";

function evidencePayload(ids) {
  const evidence = {};
  for (const id of ids) {
    evidence[id] = { failed_step: "build", error_lines: ["boom"], collected_at: "2026-09-30T05:00:00Z" };
  }
  return { schema_version: 1, collected_at: "2026-09-30T05:00:00Z", evidence };
}

function baseOpts(overrides = {}) {
  const calls = { driver: [], listFixPrs: 0 };
  const deps = {
    readEvidence: () => evidencePayload(["sig-b", "sig-a", "sig-c"]),
    listFixPrs: () => {
      calls.listFixPrs += 1;
      return [];
    },
    runDriver: (opts) => {
      calls.driver.push(opts.signalId);
      return { ok: true, branch: `engbrain-fix/x-${opts.signalId}-deadbeef`, pr: { number: 1, url: "u" } };
    },
  };
  return {
    calls,
    opts: {
      evidencePath: "/tmp/evidence.json",
      repoRoot: "/tmp/repo",
      baseCommit: BASE,
      deps: { ...deps, ...(overrides.deps || {}) },
      ...overrides.opts,
    },
  };
}

describe("runNightlySelfHeal", () => {
  it("attempts signals in deterministic signal_id order", () => {
    const { calls, opts } = baseOpts();
    const r = runNightlySelfHeal(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toEqual(["sig-a", "sig-b", "sig-c"]);
    expect(r.attempted.map((a) => a.signalId)).toEqual(["sig-a", "sig-b", "sig-c"]);
    expect(r.attempted.every((a) => a.outcome === "pr-opened")).toBe(true);
  });

  it("caps attempts at maxAttempts and defers the rest", () => {
    const { calls, opts } = baseOpts({ opts: { maxAttempts: 2 } });
    const r = runNightlySelfHeal(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toEqual(["sig-a", "sig-b"]);
    expect(r.deferred).toEqual([{ signalId: "sig-c", outcome: "deferred", reason: "max-attempts-reached" }]);
  });

  it("defaults maxAttempts to 3", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
  });

  it("skips signals with a prior open fix PR without calling the driver", () => {
    const { calls, opts } = baseOpts({
      deps: {
        listFixPrs: () => [
          { number: 42, state: "open", head: "engbrain-fix/build-sig-b-12345678", title: "fix(engineering-brain): build in x from sig-b" },
        ],
      },
    });
    const r = runNightlySelfHeal(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toEqual(["sig-a", "sig-c"]);
    expect(r.skipped).toEqual([{ signalId: "sig-b", outcome: "already-open", pr: 42 }]);
  });

  it("skips signals with a prior merged or closed fix PR", () => {
    const { calls, opts } = baseOpts({
      deps: {
        listFixPrs: () => [
          { number: 7, state: "merged", head: "engbrain-fix/build-sig-a-aaaaaaaa", title: "fix(engineering-brain): build in x from sig-a" },
          { number: 8, state: "closed", head: "engbrain-fix/build-sig-c-bbbbbbbb", title: "fix(engineering-brain): build in x from sig-c" },
        ],
      },
    });
    const r = runNightlySelfHeal(opts);
    expect(calls.driver).toEqual(["sig-b"]);
    expect(r.skipped).toEqual([
      { signalId: "sig-a", outcome: "already-merged", pr: 7 },
      { signalId: "sig-c", outcome: "already-closed", pr: 8 },
    ]);
  });

  it("does not match fix PRs for other signals", () => {
    const { calls, opts } = baseOpts({
      deps: {
        listFixPrs: () => [
          { number: 9, state: "open", head: "engbrain-fix/build-sig-zz-cccccccc", title: "fix(engineering-brain): build in x from sig-zz" },
          { number: 10, state: "open", head: "main", title: "unrelated" },
        ],
      },
    });
    const r = runNightlySelfHeal(opts);
    expect(calls.driver).toEqual(["sig-a", "sig-b", "sig-c"]);
    expect(r.skipped).toEqual([]);
  });

  it("records clean driver stops and stays ok", () => {
    const { opts } = baseOpts({
      deps: { runDriver: () => ({ ok: false, stage: "propose", reason: "no-patch" }) },
    });
    const r = runNightlySelfHeal(opts);
    expect(r.ok).toBe(true);
    expect(r.attempted).toEqual([
      { signalId: "sig-a", outcome: "clean-stop", stage: "propose", reason: "no-patch" },
      { signalId: "sig-b", outcome: "clean-stop", stage: "propose", reason: "no-patch" },
      { signalId: "sig-c", outcome: "clean-stop", stage: "propose", reason: "no-patch" },
    ]);
  });

  it("a throwing driver is recorded, others still run, and the run fails", () => {
    const seen = [];
    const { opts } = baseOpts({
      deps: {
        runDriver: ({ signalId }) => {
          seen.push(signalId);
          if (signalId === "sig-b") throw new Error("network blew up");
          return { ok: true, branch: "b", pr: { number: 1, url: "u" } };
        },
      },
    });
    const r = runNightlySelfHeal(opts);
    expect(seen).toEqual(["sig-a", "sig-b", "sig-c"]);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("run-driver");
    expect(r.reason).toBe("driver-threw");
    expect(r.attempted.find((a) => a.signalId === "sig-b").outcome).toBe("driver-threw");
    expect(r.attempted.find((a) => a.signalId === "sig-c").outcome).toBe("pr-opened");
  });

  it("fail-closes on unreadable evidence", () => {
    const { opts } = baseOpts({ deps: { readEvidence: () => { throw new Error("gone"); } } });
    const r = runNightlySelfHeal(opts);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("load-evidence");
  });

  it("fail-closes on malformed evidence payload", () => {
    const { opts } = baseOpts({ deps: { readEvidence: () => 42 } });
    const r = runNightlySelfHeal(opts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed-evidence");
  });

  it("exits clean with no usable signals", () => {
    const { opts } = baseOpts({ deps: { readEvidence: () => ({ evidence: {} }) } });
    const r = runNightlySelfHeal(opts);
    expect(r.ok).toBe(true);
    expect(r.note).toBe("no-usable-signals");
    expect(r.attempted).toEqual([]);
  });

  it("fail-closes on missing context and malformed base/maxAttempts", () => {
    expect(runNightlySelfHeal({ repoRoot: "r", baseCommit: BASE }).ok).toBe(false);
    expect(runNightlySelfHeal({ evidencePath: "e", repoRoot: "r", baseCommit: "zzz" }).reason).toBe(
      "malformed-base-commit",
    );
    expect(runNightlySelfHeal({ evidencePath: "e", repoRoot: "r", baseCommit: BASE, maxAttempts: 0 }).reason).toBe(
      "malformed-max-attempts",
    );
    expect(runNightlySelfHeal({ evidencePath: "e", repoRoot: "r", baseCommit: BASE, maxAttempts: 2.5 }).reason).toBe(
      "malformed-max-attempts",
    );
  });

  it("--signal restricts to one id and fail-closes on unknown", () => {
    const { calls, opts } = baseOpts({ opts: { signalId: "sig-b" } });
    const r = runNightlySelfHeal(opts);
    expect(calls.driver).toEqual(["sig-b"]);
    expect(r.ok).toBe(true);
    const bad = runNightlySelfHeal({ ...opts, signalId: "nope" });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unknown-signal");
  });

  it("dry-run never calls the driver", () => {
    const { calls, opts } = baseOpts({ opts: { dryRun: true } });
    const r = runNightlySelfHeal(opts);
    expect(calls.driver).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.attempted.every((a) => a.outcome === "would-attempt")).toBe(true);
  });

  it("passes pushBranch/openPr through to the driver deps", () => {
    const { opts } = baseOpts();
    const pushBranch = () => {};
    const openPr = () => ({});
    const seen = {};
    opts.deps.runDriver = (o) => {
      seen.pushBranch = o.deps.pushBranch;
      seen.openPr = o.deps.openPr;
      return { ok: true, branch: "b", pr: { number: 1, url: "u" } };
    };
    opts.deps.pushBranch = pushBranch;
    opts.deps.openPr = openPr;
    runNightlySelfHeal({ ...opts, signalId: "sig-a" });
    expect(seen.pushBranch).toBe(pushBranch);
    expect(seen.openPr).toBe(openPr);
  });
});

describe("findPriorFixPr", () => {
  it("requires both the branch prefix and the signal id in the title", () => {
    const prs = [
      { number: 1, state: "open", head: "engbrain-fix/build-sig-a-12345678", title: "fix(engineering-brain): build in x from sig-a" },
    ];
    expect(findPriorFixPr(prs, "sig-a").number).toBe(1);
    expect(findPriorFixPr(prs, "sig-b")).toBe(null);
    expect(findPriorFixPr([{ number: 2, head: "feature/x", title: "from sig-a" }], "sig-a")).toBe(null);
    expect(findPriorFixPr([], "sig-a")).toBe(null);
  });
});

describe("makeGithubActionsDeps", () => {
  function fakeExec(log) {
    return (cmd, args, opts = {}) => {
      log.push({ cmd, args, env: opts.env });
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") return "https://github.com/o/r/pull/123\n";
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list")
        return JSON.stringify([
          { number: 5, state: "OPEN", headRefName: "engbrain-fix/build-sig-a-12345678", title: "fix(engineering-brain): build in x from sig-a" },
        ]);
      if (cmd === "git") return "";
      throw new Error(`unexpected call ${cmd}`);
    };
  }

  it("builds push/openPr/listFixPrs against a fake exec with no network", () => {
    const log = [];
    const deps = makeGithubActionsDeps({ token: "tok", repo: "o/r", exec: fakeExec(log) });
    deps.pushBranch({ worktree: "/tmp/wt", branch: "engbrain-fix/x" });
    expect(log[0].cmd).toBe("git");
    expect(log[0].args).toContain("engbrain-fix/x:engbrain-fix/x");
    expect(log[0].args.some((a) => String(a).includes("tok"))).toBe(true);

    const pr = deps.openPr({ branch: "engbrain-fix/x", title: "t", body: "b" });
    expect(pr).toEqual({ number: 123, url: "https://github.com/o/r/pull/123" });
    expect(log[1].env.GH_TOKEN).toBe("tok");
    expect(log[1].env.PATH).toBe(process.env.PATH);

    const prs = deps.listFixPrs();
    expect(prs).toEqual([{ number: 5, state: "open", head: "engbrain-fix/build-sig-a-12345678", title: "fix(engineering-brain): build in x from sig-a" }]);
  });

  it("never leaks the token in thrown errors", () => {
    const deps = makeGithubActionsDeps({
      token: "secret-token",
      repo: "o/r",
      exec: () => { throw new Error("boom secret-token in message"); },
    });
    for (const fn of [() => deps.pushBranch({ worktree: "w", branch: "b" }), () => deps.openPr({ branch: "b", title: "t" }), () => deps.listFixPrs()]) {
      try {
        fn();
        expect.unreachable();
      } catch (e) {
        expect(String(e.message).includes("secret-token")).toBe(false);
      }
    }
  });

  it("requires token and repo", () => {
    expect(() => makeGithubActionsDeps({ repo: "o/r" })).toThrow();
    expect(() => makeGithubActionsDeps({ token: "t", repo: "oops" })).toThrow();
  });
});

describe("runNightlySelfHealCli parseArgs", () => {
  it("parses all flags", () => {
    expect(
      parseArgs([
        "--evidence", "e.json", "--repo", "r", "--base", "abc123",
        "--signal", "s", "--max-attempts", "5", "--github-actions", "--dry-run", "--json",
      ]),
    ).toEqual({
      evidence: "e.json", repo: "r", base: "abc123", signalId: "s",
      maxAttempts: "5", githubActions: true, dryRun: true, json: true,
    });
  });

  it("leaves optionals undefined", () => {
    expect(parseArgs(["--evidence", "e", "--repo", "r", "--base", "b"])).toEqual({
      evidence: "e", repo: "r", base: "b",
    });
  });
});
