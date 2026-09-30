# Trust boundaries and data flow (assignment section D)

## Pipeline

```
Windows OS security sources            (see windows-sources.md)
        |
        v
Local collector                        least-privileged where possible;
        |                               narrowly-scoped privileged reads
        v                               isolated where unavoidable
Normalization                          raw OS response -> the schema in
        |                               privacy-data-contract.md
        v
Deterministic rules                    severity-rules.md; produces
        |                               event_type + severity + rule_id
        v
Append-only local evidence/event store  Rung 2; local disk/DB, no cloud
        |
        v
FORGE Security UI                      Rung 4; read path only, LOCAL-ONLY —
        |                               bound to loopback / a local desktop
        v                               shell, NOT the hosted marketplace409
                                        app (see ADR-005)
FORGE Brain explanation layer          Rung 5; read-only queries over
                                        normalized evidence, never a write
                                        path into the store
```

Each arrow is a trust boundary. Data only ever flows downward in this
diagram in Rungs 0–5: nothing above the evidence store writes back upstream,
and nothing at or below the UI layer can act on the machine (no arrow points
back up to "Windows OS security sources" until Rung 6, and even then only
through a narrowly scoped, separately reviewed action layer — see
[ADR-004](./ADR-004-human-confirmed-response.md)).

## Privilege boundaries

The collector is the only component that touches the OS directly, so it is
the only component whose privilege matters:

- **Default: least-privileged.** Most of the [source inventory](./windows-sources.md)
  is readable as a standard user or a user in the built-in `Event Log
  Readers` group — Defender status, firewall profile/rules, scheduled
  tasks/services enumeration, socket enumeration for the collector's own
  reachable processes, RDP config registry values, browser-extension
  metadata.
- **Narrow, explicit admin reads where unavoidable.** Full local-account/
  admin-group enumeration across all users, and full listening-socket
  attribution across other users' processes, are the two sources in the
  inventory that need `admin`. Rung 1 should isolate exactly these calls
  behind their own narrowly-scoped code path (a single function/module per
  privileged read), not run the whole collector elevated to get them.
- **No privileged always-on service unless a later rung proves it necessary.**
  The technology-choice ADR ([ADR-005](./ADR-005-windows-agent.md)) discusses
  whether the initial collector should even be a persistent service versus a
  scheduled/on-demand process; either way, "isolated and narrowly scoped" is
  the requirement for any privileged code path, not "run everything as
  SYSTEM because it's simpler."
- **No inbound network control surface.** The collector does not listen for
  commands from the network in Rungs 0–5 (product boundary #11). It only
  writes to the local evidence store and is read by the local, loopback-bound
  FORGE Security UI process — never by the hosted marketplace409 app (see
  the UI boundary correction below). This removes an entire class of
  "attacker controls the security monitor remotely" risk before it can exist.

## The Rung 4 UI is local-only, not the hosted FORGE app

**Corrected 2026-09-30, per ChatGPT review of PR #493 (finding 1):** an
earlier draft of this document said the Rung 4 dashboard would be
"authenticated within the existing FORGE app" and could "reuse existing
FORGE app infrastructure." That was inconsistent with [ADR-002](./ADR-002-local-first.md)'s
local-first commitment — marketplace409's production deployment is
Vercel-hosted and has no path to read a local evidence store on Jason's
workstation, so "read path only, authenticated within the existing FORGE
app" was not actually achievable without violating ADR-002.

The corrected, accepted decision (finalizing [ADR-005](./ADR-005-windows-agent.md)'s
previously-open question): **for Rungs 1–7, the FORGE Security dashboard is
local-only** — served by the local agent itself, bound to loopback
(`127.0.0.1`) or presented as a local desktop shell, the same shape FORGE
Capture already uses for capabilities a hosted web app can't provide. It may
reuse FORGE's visual design conventions, but it is not a module of the
hosted marketplace409 app, does not share its auth session, and does not
send evidence to it. Remote/integrated viewing inside the main FORGE app is
a **Rung 8** decision only, after that rung's own dedicated sync/control-
channel threat model.

## Where FORGE Security sits relative to the rest of marketplace409

FORGE Security is a new, isolated module — not a feature bolted onto Rental,
Scheduling, Designer, ledger, or Engineering Brain. Two shared architectural
habits from the existing FORGE codebase are worth reusing because they
genuinely fit, per the assignment's own guidance to reuse patterns "only
where they genuinely fit":

- **Append-only evidence/event modeling** — this codebase already has
  precedent for treating certain records as an immutable event history rather
  than a mutable row (see `FORGE_CONSTITUTION.md`'s "immutable core objects"
  rule). The Rung 2 evidence ledger should follow that same discipline:
  events are appended, not edited in place; a purge is a deliberate delete
  operation, not an update.
- **Domain-Driven Design boundary** — pure normalization/severity-rule logic
  belongs in a framework-free `src/domains/<name>/`-style module, unit-tested
  without touching the OS, exactly like every other FORGE domain. The OS-
  reading collector code is the one part of this product that cannot be a
  pure domain module (it necessarily talks to the OS), so it should be kept
  as thin as possible and isolated behind an interface the domain logic can
  be tested against with fakes.

The Rung 4 UI shell is its own small local surface (see the correction
above), not a reuse of the hosted FORGE app's deployment/auth — but it can
still borrow FORGE's visual/design conventions for consistency. Rung 0–3
need none of that.

## What this diagram deliberately does not show yet

- The concrete process/service boundary for the collector (native agent vs.
  something hosted by the Next.js app) — that's a technology choice, covered
  in [ADR-005](./ADR-005-windows-agent.md), not a trust-boundary question.
- Any multi-machine communication — out of scope until Rung 8, which will
  need its own trust-boundary diagram once a control channel exists to
  threat-model.
