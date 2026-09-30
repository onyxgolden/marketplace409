# ADR-SEC-001 — FORGE Security augments Defender/OS protections, never replaces them

Date: 2026-09-30
Status: Proposed (Rung 0) — accepted only after architecture review of the Rung 0 PR.

## Context

Jason wants an internal FORGE security application. The most tempting
architecture for "a security product" is to build a detection engine: a
signature/heuristic scanner that competes with Microsoft Defender. That is
explicitly out of scope per the assignment's own framing: "The goal is NOT to
reinvent a commercial antivirus engine."

## Decision

- FORGE Security **reads** Defender's status, configuration, and detection
  history (see [`windows-sources.md`](./windows-sources.md#1-microsoft-defender-antivirus))
  and surfaces it inside one FORGE console. It does not scan files for
  malware itself, does not maintain a signature database, and does not
  attempt to catch anything Defender missed via its own detection logic.
- FORGE Security must never disable, replace, bypass, or weaken Defender,
  Windows Firewall, SmartScreen, Windows Update, or UAC — this is a hard
  product boundary, not a default that a later rung can quietly relax.
- Where FORGE Security adds genuine new value over what Windows Security
  already shows, it is in **consolidation** (one console across Defender +
  Firewall + persistence + accounts + network exposure + file integrity),
  **history** (an append-only local event ledger Windows Security itself does
  not keep long-term), and **explanation** (deterministic rules now, Brain
  explanation later) — not in independent detection.

## Consequences

- Rung 1 has no "scan engine" work item, ever. If a future rung proposes one,
  it needs its own ADR overriding this one, with Jason's explicit sign-off.
- FORGE Security's value proposition is legible: it is a lens on OS state,
  not a competing product. This keeps the trust story simple ("it reads what
  Windows already knows and never turns anything off") and keeps the
  implementation surface small enough for one person to review.
- Malware detections Defender does not catch are outside FORGE Security's
  responsibility. This is a known limitation, stated here rather than implied.
