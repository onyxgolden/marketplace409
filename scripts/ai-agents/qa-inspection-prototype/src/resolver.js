/**
 * resolver.js — FixtureResolver: the trusted fixture adapter for slice 1.
 *
 * The prototype reads registered synthetic fixture content ONLY through this
 * scoped resolver, injected via context by the host harness. It binds
 * build_id -> {repo, commit, environment}, serves evidence records, resolves
 * run metadata and artifact bytes independently, and answers grant checks.
 * For slice 1, mock trusted registration is sufficient and less misleading
 * than simulated signatures.
 *
 * The resolver never executes controls, never touches the network or the
 * filesystem, and never returns live data. All content is synthetic fixtures
 * supplied by the harness.
 */

import { createHash } from "node:crypto";

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export class FixtureResolver {
  /**
   * @param {object} fixtures
   * @param {Record<string,{build_id,repo,commit,environment}>} fixtures.builds
   * @param {Array<object>} fixtures.evidence  — evidence records
   * @param {Record<string,{bytes_b64,sha256,media_type,byte_length}>} fixtures.artifacts
   * @param {Record<string,object>} fixtures.runs — run_id -> run metadata
   * @param {Record<string,{allowed:boolean,reason:string}>} fixtures.grants — evidence_id -> grant
   */
  constructor(fixtures) {
    this.builds = fixtures.builds ?? {};
    this.evidence = fixtures.evidence ?? [];
    this.artifacts = fixtures.artifacts ?? {};
    this.runs = fixtures.runs ?? {};
    this.grants = fixtures.grants ?? {};
    // Instrumentation for the zero-side-effect gate: the harness counts these.
    this.stats = { buildReads: 0, evidenceReads: 0, runReads: 0, artifactReads: 0, grantReads: 0 };
  }

  /** Bind a build_id to its registered repo/commit/environment. */
  getBuild(build_id) {
    this.stats.buildReads += 1;
    const b = this.builds[build_id];
    return b ? { ...b } : null;
  }

  /** All evidence records naming a control. Detached copies. */
  evidenceFor(control_id) {
    this.stats.evidenceReads += 1;
    return this.evidence
      .filter((e) => e.control_id === control_id)
      .map((e) => JSON.parse(JSON.stringify(e)));
  }

  /** Independently resolve run metadata. Null when the run is not registered. */
  resolveRun(run_id) {
    this.stats.runReads += 1;
    const r = this.runs[run_id];
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  /**
   * Independently resolve artifact bytes and recompute the digest over the
   * actual registered bytes. Null when the artifact is not registered.
   */
  resolveArtifact(fixture_id) {
    this.stats.artifactReads += 1;
    const a = this.artifacts[fixture_id];
    if (!a) return null;
    const bytes = Buffer.from(a.bytes_b64, "base64");
    return {
      bytes,
      sha256: sha256Hex(bytes),
      media_type: a.media_type,
      byte_length: bytes.length,
    };
  }

  /** Scoped read grant for an evidence record. Default deny. */
  checkGrant(evidence_id) {
    this.stats.grantReads += 1;
    const g = this.grants[evidence_id];
    if (!g) return { allowed: false, reason: "no grant registered" };
    return { allowed: g.allowed === true, reason: g.reason ?? "" };
  }
}

/**
 * Build a FixtureResolver from plain JSON fixture files (harness-side helper).
 */
export function resolverFromJson({ builds, evidence, artifacts, runs, grants }) {
  return new FixtureResolver({ builds, evidence, artifacts, runs, grants });
}
