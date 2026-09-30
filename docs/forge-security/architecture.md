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
FORGE Security UI                      Rung 4; read path only, authenticated
        |                               within the existing FORGE app
        v
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
  writes to the local evidence store and is read by the local FORGE Security
  UI process. This removes an entire class of "attacker controls the security
  monitor remotely" risk before it can exist.

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

Everything else — the UI shell, auth, deployment — can reuse existing FORGE
app infrastructure (Rung 4) once there's evidence to show. Rung 0–3 need none
of that.

## What this diagram deliberately does not show yet

- The concrete process/service boundary for the collector (native agent vs.
  something hosted by the Next.js app) — that's a technology choice, covered
  in [ADR-005](./ADR-005-windows-agent.md), not a trust-boundary question.
- Any multi-machine communication — out of scope until Rung 8, which will
  need its own trust-boundary diagram once a control channel exists to
  threat-model.
