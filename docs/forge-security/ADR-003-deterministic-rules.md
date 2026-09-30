# ADR-SEC-003 — Deterministic rules before AI judgment

Date: 2026-09-30
Status: Proposed (Rung 0) — accepted only after architecture review of the Rung 0 PR.

## Context

FORGE already has an Engineering Brain workstream exploring AI-driven
analysis elsewhere in the codebase. It would be tempting to route FORGE
Security's classification through a similar AI judgment call from the start
— "is this suspicious?" But a security product's authoritative state (is
Defender on, is there a new admin account, is this port newly listening)
needs to be independently verifiable and stable, not subject to a model's
possibly-inconsistent judgment on the same input.

## Decision

- Deterministic collectors and rules (see [`severity-rules.md`](./severity-rules.md))
  are the **sole authority** for security state and automated severity
  classification in Rungs 0–5.
- Every classified event carries the raw OS-reported state/severity
  (`raw_os_severity`/`raw_os_state`) **alongside**, never instead of, FORGE's
  own deterministic classification (`severity`, `rule_id`). Neither value
  overwrites the other.
- AI (FORGE Brain, Rung 5+) may **explain** evidence that deterministic rules
  already produced — answering "what changed" and "why was this flagged" by
  reading the existing record — but it may not invent evidence, change a
  stored severity, silently reclassify an event, or execute a response
  action. This mirrors the contract already written down for Koe Sr/Muse in
  the cross-team awareness note (`commands/forge-security-awareness-for-koe-sr-muse.md`
  in `forge-ai-drop`).

## Consequences

- Every alert Jason sees has a reproducible, named rule behind it
  (`rule_id` + `rule_explanation`), so "why am I seeing this" is always
  answerable without asking a model and hoping for a consistent answer.
- Adding or changing detection logic is a normal code change (new/updated
  rule, its own test), reviewable the same way any other FORGE domain logic
  is reviewed — not a prompt-tuning exercise.
- This intentionally limits what Rung 0–5 can detect to what deterministic
  rules over structured OS evidence can express. Genuinely novel, hard-to-
  rule-for threats are a known gap, not silently painted over by an opaque
  score.
