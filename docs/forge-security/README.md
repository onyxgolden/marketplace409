# FORGE Security — Rung 0 architecture package

**Status:** Proposed (Rung 0) — discovery/design only, no runtime code in this package.
**Date:** 2026-09-30
**Owner:** Jason
**Assignee:** Claude
**Reviewer:** ChatGPT (architecture gate before Rung 1)

## What this is

FORGE Security is a new, separate product: a Windows-first defensive security
monitoring, evidence, and hardening layer for machines Jason owns and
administers, starting with his iBUYPOWER workstation. It gives Jason one
console for **what changed, what is risky, and why** — built on top of
existing OS security surfaces (Microsoft Defender, Windows Firewall, Windows
Event Log, etc.), never replacing or weakening them.

It is not an antivirus engine, not a SIEM, not a remote-control tool, and (in
these early rungs) not a remediation tool. It observes and explains; a human
confirms anything consequential.

This is a distinct module from FORGE's real-estate marketplace domains
(Rental, Scheduling, Designer, ledger) and from Engineering Brain. See
[`../product/forge-capture/RUNG0_ADR.md`](../product/forge-capture/RUNG0_ADR.md)
for the sibling precedent of a FORGE product that also began life as an
architecture-only Rung 0 package before any runtime code was written.

## Why this package exists

Jason asked for an internal FORGE security application for his own machines.
The full assignment (non-negotiable product boundaries, target machines,
Rung 0 scope, and the Rung 1–8 product ladder) is preserved verbatim at
`commands/claude/forge-security-rung0-and-ladder.md` in the `forge-ai-drop`
coordination repo. This package is the Rung 0 deliverable for that
assignment: it does not introduce a monitoring agent, dashboard, database
migration, or background service. It documents what would exist and why,
so the design can be reviewed before any of it is built.

## Non-negotiable product boundaries (carried from the assignment)

1. Defensive use only, on machines Jason owns/administers.
2. Windows first; Linux later (Rung 7).
3. Never disable, replace, bypass, or weaken Defender, Firewall, SmartScreen,
   Windows Update, UAC, or equivalent OS protections.
4. Prefer reading supported OS security surfaces over building a
   malware-signature engine.
5. Local-first collection — no telemetry, file contents, credentials,
   browser history, or private documents leave the machine.
6. No credential harvesting, ever — not passwords, tokens, private keys,
   cookies, session secrets, or `.env` contents.
7. Default to observe + explain. No automatic kill/quarantine/isolate/delete/
   revoke/disable in these rungs.
8. Any later consequential action requires explicit human confirmation and
   produces an evidence/audit event.
9. Evidence is attributable: timestamp, machine, source, event type,
   identifiers/metadata, deterministic reason/rule.
10. Deterministic collectors/rules are authoritative for security state;
    Brain may explain evidence later but must not invent it.
11. No inbound network control surface on the monitoring agent in early rungs.
12. No production deploy, no new paid service, no cloud security vendor
    dependency in Rung 0.

## How to read this package

| Document | Covers assignment section |
| --- | --- |
| [`windows-sources.md`](./windows-sources.md) | A — existing protection inventory: every Windows security surface FORGE Security reads from, with the exact supported mechanism, privilege, reliability, and sensitivity for each. |
| [`threat-model.md`](./threat-model.md) | B — the threats this product is meant to surface, and explicit non-goals. |
| [`privacy-data-contract.md`](./privacy-data-contract.md) | C — the minimum event schema, what must never be collected, retention, and purge. |
| [`architecture.md`](./architecture.md) | D — trust boundaries, data flow, privilege boundaries. |
| [`severity-rules.md`](./severity-rules.md) | E — the deterministic severity model. |
| [`ux-specification.md`](./ux-specification.md) | F — the first dashboard, specified but not built. |
| `ADR-001` … `ADR-005` | G — the five required architecture decisions. |
| [`product-ladder.md`](./product-ladder.md) | The Rung 1–8 roadmap, restated from the assignment as a living reference, plus the engineering rules that apply to every rung. |

## What is explicitly out of scope for Rung 0

- No collector code, no service, no database schema, no UI code.
- No live investigation of Jason's actual workstation from this repo/session
  — Rung 0 is a design exercise grounded in publicly documented Windows
  mechanisms, not a live audit. Rung 1 is where a real collector first reads
  real machine state.
- No decision yet on packaging/signing/distribution mechanics beyond the
  technology-choice recommendation in ADR-005.

## Review gate

This package ships as its own PR, not merged. A review request goes to
`commands/chatgpt/` in `forge-ai-drop` with the PR's exact head SHA, per the
standing FORGE review protocol. Rung 1 does not start until that review
lands and Jason approves proceeding.
