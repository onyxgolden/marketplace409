# ADR-SEC-004 — Observe-only default; human-confirmed response actions only

Date: 2026-09-30
Status: Proposed (Rung 0) — accepted only after architecture review of the Rung 0 PR.

## Context

The most valuable-sounding feature of a security product is often automated
response: "kill the bad process," "quarantine the file," "isolate the
machine." It's also the most dangerous to get wrong — a false positive that
auto-kills a legitimate process, or auto-disables networking on a workstation
Jason is actively using for local-AI/development work, causes real harm on
its own. The assignment is explicit that this product defaults to
observe + explain, with any consequential action gated on Rung 6 and never
autonomous even there.

## Decision

- Rungs 0–5 implement **zero** response capability: no automatic process
  termination, file quarantine/deletion, network isolation, credential
  revocation, or account/service disabling, ever, regardless of severity band.
  A `critical` event is surfaced prominently; it is never acted on by the
  system itself.
- Rung 6 ("explicit response controls") is the only point any response action
  is introduced, and every such action requires, at minimum: precondition
  checks (is the target still in the state the evidence described?),
  explicit per-action human confirmation (not a standing "auto-approve
  criticals" toggle), an audit event recording who confirmed what and when,
  post-action result verification, and recovery guidance if the action needs
  to be undone.
- Brain (Rung 5+) is explicitly barred from executing response actions itself,
  even ones a human could trigger through the Rung 6 UI — Brain's role stays
  read-only explanation, full stop, per [ADR-003](./ADR-003-deterministic-rules.md).

## Consequences

- Jason retains full manual control the entire time FORGE Security exists in
  these rungs — it can never take an action he didn't personally confirm.
- This defers real remediation value until Rung 6, which is an acceptable
  trade against the alternative (an automated system with false-positive
  blast radius on Jason's own primary development machine).
- Rung 6's design work is nontrivial on its own (precondition checking,
  confirmation UX, audit, verification, recovery) and deserves its own
  architecture review when it's proposed — this ADR commits to the shape of
  that gate, not its implementation.
