# Product ladder (Rung 1–8)

This restates the roadmap from the originating assignment
(`commands/claude/forge-security-rung0-and-ladder.md` in `forge-ai-drop`) as
a living reference inside the repo. **None of these rungs start until Rung 0
is reviewed and Jason approves proceeding.** Each rung is its own small PR
with its own exact-head ChatGPT review, per the standing FORGE review
protocol — no rung bundles into another.

## Rung 1 — Windows local status collector

Minimum local agent/read model for machine identity and protection posture:
Defender status, Firewall profiles/status, whatever update/security posture
can be obtained reliably, OS/build/agent version, collection timestamps and
errors. Fail closed/unknown when a source can't be read. No remediation.
Technology starting point: see [ADR-005](./ADR-005-windows-agent.md).

## Rung 2 — Local evidence/event ledger

Normalized, append-only local security events with provenance and
deterministic IDs/deduplication, per the [privacy/data contract](./privacy-data-contract.md).
Retention/purge controls and schema versioning established here. Still no
automatic response.

## Rung 3 — Persistence/account/network/file-integrity watchers

Incrementally add: services, scheduled tasks, startup persistence,
local/admin account changes, RDP/remote-access state, listening-port/
exposure deltas, allowlisted critical-file hashes. Avoid broad surveillance.
Baseline/delta behavior must distinguish first observation from a genuine
change, per the rule established in [`severity-rules.md`](./severity-rules.md#rules-for-building-the-real-rule-table-rung-13).

## Rung 4 — FORGE Security dashboard

A **local-only** read UI (resolved decision, see
[ADR-005](./ADR-005-windows-agent.md#ui-locality--resolved-2026-09-30-was-an-open-question-see-git-history-for-the-original-framing) —
bound to loopback or a local desktop shell, never the hosted marketplace409
app): machine status, recent alerts/events, evidence details, filters,
provenance, collector health — specified in
[`ux-specification.md`](./ux-specification.md). Never claim "safe" when
evidence is missing; use unknown/stale states.

## Rung 5 — FORGE Brain security explanations

Read-only Brain queries over normalized evidence: "what changed on this
machine since yesterday," "why was this flagged," "when did Defender/
firewall state change." Brain may summarize/explain; it must not fabricate
evidence, change severity, or execute response actions — see
[ADR-003](./ADR-003-deterministic-rules.md).

## Rung 6 — Explicit response controls

Only after its own architecture/review: user-confirmed process termination
where technically justified, user-confirmed quarantine/request-to-Defender
where supported, user-confirmed firewall/network isolation controls,
user-confirmed account/service containment. Every action needs precondition
checks, explicit confirmation, an audit event, result verification, and
recovery guidance. No autonomous remediation, ever — see
[ADR-004](./ADR-004-human-confirmed-response.md).

## Rung 7 — Linux agent

Port the evidence contract and deterministic rule model to Linux using
native supported sources. Do not force Windows-specific semantics onto
Linux — a fresh source inventory (analogous to [`windows-sources.md`](./windows-sources.md))
is expected here, not a mechanical translation.

## Rung 8 — Multi-machine console + hardened distribution

Machine enrollment, signed agent releases, secure update mechanism, machine
health/staleness, and local-network or deliberately designed synchronization
if Jason chooses it. **Threat-model the control channel before enabling
remote commands** — this is also where the local-vs-integrated-UI question
deferred in [ADR-005](./ADR-005-windows-agent.md) gets a proper resolution if
Jason wants remote viewing.

## Engineering rules for all rungs

- One rung/slice at a time; review gate before the next.
- Small PRs with exact-head ChatGPT review.
- No unrelated refactors.
- Tests for deterministic parsing/rules/normalization.
- Never report missing evidence as healthy.
- Preserve raw OS-reported severity/state separately from FORGE
  classification.
- All security-source failures must be visible, not silently swallowed into
  "OK."
- Do not add paid dependencies/services without Jason's approval.
- Do not weaken existing host security to make collection easier.
- Do not log secrets.
- Treat paths/process command lines/event payloads as potentially sensitive
  and minimize before persistence.
- Any future elevated helper must expose the smallest possible command
  surface and validate all inputs.
