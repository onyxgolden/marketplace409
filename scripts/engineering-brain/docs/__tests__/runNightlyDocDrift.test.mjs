import { describe, expect, it } from "vitest";
import {
  runNightlyDocDrift,
  driftIdFor,
  DEFAULT_MAX_FIXES,
} from "../runNightlyDocDrift.mjs";
import { parseArgs } from "../runNightlyDocDriftCli.mjs";

const BASE = "abc1234";

function finding(docPath, line, driftClass = "doc-dead-path-literal") {
  return { driftClass, docPath, line, literal: "x", detail: "d" };
}

function entry(docPath, line, { proposable = true, reason = null } = {}) {
  const f = finding(docPath, line);
  return {
    finding: f,
    proposable,
    reason,
    explanation: proposable ? "fix" : null,
    patch: proposable ? { noPatch: false, path: docPath } : { noPatch: true, reason: reason || "x" },
  };
}

function baseOpts(overrides = {}) {
  const calls = { driver: [], listFixPrs: 0, scan: 0 };
  const deps = {
    scanAndPropose: () => {
      calls.scan += 1;
      return [entry("docs/c.md", 3), entry("docs/a.md", 9), entry("docs/b.md", 1)];
    },
    listFixPrs: () => {
      calls.listFixPrs += 1;
      return [];
    },
    runDriver: (opts) => {
      calls.driver.push(opts.driftId);
      return { ok: true, branch: `engbrain-fix/x-${opts.driftId}-deadbeef`, pr: { number: 7, url: "u" } };
    },
  };
  return {
    calls,
    opts: {
      repoRoot: "/tmp/repo",
      baseCommit: BASE,
      deps: { ...deps, ...(overrides.deps || {}) },
      ...overrides.opts,
    },
  };
}

describe("driftIdFor", () => {
  it("builds the stable doc-drift identity", () => {
    expect(driftIdFor(finding("docs/x.md", 12, "doc-dead-script-ref"))).toBe(
      "doc-drift/doc-dead-script-ref/docs/x.md:12",
    );
  });
});

describe("runNightlyDocDrift", () => {
  it("attempts findings in deterministic drift-id order", () => {
    const { calls, opts } = baseOpts();
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toEqual([
      "doc-drift/doc-dead-path-literal/docs/a.md:9",
      "doc-drift/doc-dead-path-literal/docs/b.md:1",
      "doc-drift/doc-dead-path-literal/docs/c.md:3",
    ]);
    expect(r.attempted.every((a) => a.outcome === "pr-opened")).toBe(true);
  });

  it("caps attempts at maxFixes and defers the rest", () => {
    const { calls, opts } = baseOpts({ opts: { maxFixes: 2 } });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toHaveLength(2);
    expect(r.deferred).toEqual([
      { driftId: "doc-drift/doc-dead-path-literal/docs/c.md:3", outcome: "deferred", reason: "max-fixes-reached" },
    ]);
  });

  it("defaults maxFixes to 3", () => {
    expect(DEFAULT_MAX_FIXES).toBe(3);
  });

  it("skips non-proposable findings without consuming budget", () => {
    const { calls, opts } = baseOpts({
      deps: {
        scanAndPropose: () => [
          entry("docs/a.md", 1, { proposable: false, reason: "ambiguous-match" }),
          entry("docs/b.md", 2),
          entry("docs/c.md", 3),
          entry("docs/d.md", 4),
          entry("docs/e.md", 5),
        ],
      },
      opts: { maxFixes: 3 },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    // The no-patch finding is skipped, so the first three proposable ones
    // are attempted and the fourth is deferred (budget 3).
    expect(calls.driver).toHaveLength(3);
    expect(r.skipped).toEqual([
      {
        driftId: "doc-drift/doc-dead-path-literal/docs/a.md:1",
        outcome: "no-patch",
        reason: "ambiguous-match",
      },
    ]);
    expect(r.deferred).toEqual([
      {
        driftId: "doc-drift/doc-dead-path-literal/docs/e.md:5",
        outcome: "deferred",
        reason: "max-fixes-reached",
      },
    ]);
  });

  it("skips findings with a prior open fix PR", () => {
    const priorId = "doc-drift/doc-dead-path-literal/docs/a.md:9";
    const { calls, opts } = baseOpts({
      deps: {
        listFixPrs: () => [
          { number: 42, state: "open", head: "engbrain-fix/doc-dead-path-lit-doc-drift-doc-dead-9f8e7d6c", title: `fix: doc drift ${priorId}` },
        ],
      },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).not.toContain(priorId);
    expect(r.skipped).toContainEqual({ driftId: priorId, outcome: "already-open", pr: 42 });
  });

  it("skips findings with merged or human-closed prior fix PRs", () => {
    const { opts } = baseOpts({
      deps: {
        listFixPrs: () => [
          { number: 1, state: "merged", head: "engbrain-fix/a-x", title: "x doc-drift/doc-dead-path-literal/docs/a.md:9 y" },
          { number: 2, state: "closed", head: "engbrain-fix/b-x", title: "x doc-drift/doc-dead-path-literal/docs/b.md:1 y" },
        ],
      },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.skipped).toContainEqual({
      driftId: "doc-drift/doc-dead-path-literal/docs/a.md:9",
      outcome: "already-merged",
      pr: 1,
    });
    expect(r.skipped).toContainEqual({
      driftId: "doc-drift/doc-dead-path-literal/docs/b.md:1",
      outcome: "already-closed",
      pr: 2,
    });
    // Only the third finding is attempted.
    expect(r.attempted).toHaveLength(1);
  });

  it("does not match PRs from other drift ids", () => {
    const { calls, opts } = baseOpts({
      deps: {
        listFixPrs: () => [
          { number: 9, state: "open", head: "engbrain-fix/doc-dead-path-lit-doc-drift-doc-dead-aaaa", title: "fix: doc drift doc-drift/doc-dead-path-literal/docs/zzz.md:1" },
        ],
      },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toHaveLength(3);
  });

  it("records pr-opened with branch and pr", () => {
    const { opts } = baseOpts();
    const r = runNightlyDocDrift(opts);
    const first = r.attempted[0];
    expect(first.outcome).toBe("pr-opened");
    expect(first.branch).toContain("engbrain-fix/");
    expect(first.pr).toEqual({ number: 7, url: "u" });
  });

  it("records clean stops without failing the run", () => {
    const { opts } = baseOpts({
      deps: {
        runDriver: () => ({ ok: false, stage: "apply", reason: "stale-doc" }),
      },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    expect(r.attempted.every((a) => a.outcome === "clean-stop")).toBe(true);
    expect(r.attempted[0]).toMatchObject({ stage: "apply", reason: "stale-doc" });
  });

  it("records driver throws, keeps going, and fails the run", () => {
    const { calls, opts } = baseOpts({
      deps: {
        runDriver: (o) => {
          calls.driver.push(o.driftId);
          if (o.driftId.endsWith("docs/b.md:1")) throw new Error("boom");
          return { ok: true, branch: "b", pr: { number: 1, url: "u" } };
        },
      },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("run-driver");
    expect(r.reason).toBe("driver-threw");
    expect(calls.driver).toHaveLength(3);
    expect(r.attempted.find((a) => a.driftId.endsWith("docs/b.md:1"))).toMatchObject({
      outcome: "driver-threw",
      detail: "boom",
    });
  });

  it("dry-run reports would-attempt without calling the driver", () => {
    const { calls, opts } = baseOpts({ opts: { dryRun: true } });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toHaveLength(0);
    expect(calls.listFixPrs).toBe(1);
    expect(r.attempted.every((a) => a.outcome === "would-attempt")).toBe(true);
  });

  it("filters to a single drift id", () => {
    const { calls, opts } = baseOpts({
      opts: { driftId: "doc-drift/doc-dead-path-literal/docs/b.md:1" },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(true);
    expect(calls.driver).toEqual(["doc-drift/doc-dead-path-literal/docs/b.md:1"]);
  });

  it("fails on an unknown drift id", () => {
    const { opts } = baseOpts({ opts: { driftId: "doc-drift/nope/docs/x.md:1" } });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("validate");
    expect(r.reason).toBe("unknown-drift");
  });

  it("returns a clean no-findings result", () => {
    const { opts } = baseOpts({ deps: { scanAndPropose: () => [] } });
    const r = runNightlyDocDrift(opts);
    expect(r).toMatchObject({ ok: true, note: "no-findings" });
    expect(r.attempted).toEqual([]);
  });

  it("fail-closes when the scan throws", () => {
    const { opts } = baseOpts({
      deps: { scanAndPropose: () => { throw new Error("disk gone"); } },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("scan");
    expect(r.reason).toBe("scan-threw");
  });

  it("fail-closes when listing fix PRs throws", () => {
    const { opts } = baseOpts({
      deps: { listFixPrs: () => { throw new Error("api down"); } },
    });
    const r = runNightlyDocDrift(opts);
    expect(r.ok).toBe(false);
    expect(r.stage).toBe("list-fix-prs");
    expect(r.reason).toBe("list-fix-prs-threw");
  });

  it("rejects missing context, malformed base, and bad maxFixes", () => {
    expect(runNightlyDocDrift({ baseCommit: BASE }).ok).toBe(false);
    expect(runNightlyDocDrift({ repoRoot: "/x", baseCommit: BASE }).ok).toBe(false);
    expect(runNightlyDocDrift({ repoRoot: "/x", baseCommit: "zzz" }).ok).toBe(false);
    expect(runNightlyDocDrift({ repoRoot: "/x", baseCommit: BASE, maxFixes: 0 }).ok).toBe(false);
    expect(runNightlyDocDrift({ repoRoot: "/x", baseCommit: BASE, maxFixes: 2.5 }).ok).toBe(false);
    const r = runNightlyDocDrift({ repoRoot: "/x", baseCommit: BASE, maxFixes: "nope" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed-max-fixes");
  });
});

describe("runNightlyDocDriftCli parseArgs", () => {
  it("parses repo, base, docs, max-fixes, drift-id, and flags", () => {
    const a = parseArgs([
      "--repo", "/r",
      "--base", BASE,
      "--docs", "docs", "notes",
      "--max-fixes", "2",
      "--drift-id", "doc-drift/x",
      "--dry-run",
      "--json",
    ]);
    expect(a).toMatchObject({
      repo: "/r",
      base: BASE,
      docs: ["docs", "notes"],
      maxFixes: "2",
      driftId: "doc-drift/x",
      dryRun: true,
      json: true,
    });
  });

  it("leaves docs null when the flag is absent", () => {
    expect(parseArgs(["--repo", "/r", "--base", BASE]).docs).toBeNull();
  });
});
