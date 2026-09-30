# ADR-SEC-005 — Windows-first collector technology choice

Date: 2026-09-30
Status: Proposed (Rung 0) — accepted only after architecture review of the Rung 0 PR. The UI-locality question below was resolved 2026-09-30 by ChatGPT's review of PR #493: local-only, per option (a).

## Context

The assignment asks for a comparison between realistic implementation
choices already compatible with marketplace409/FORGE: a separate native/
local agent vs. trying to do privileged monitoring from the Next.js web app.

marketplace409's production deployment is a Vercel-hosted Next.js app.
Vercel functions execute in an ephemeral cloud container with no access to
Jason's physical workstation, its registry, its WMI namespaces, its event
log, or its local processes. That is not a limitation to design around — it
is simply a different machine than the one being monitored. **The deployed
web app cannot be the collector, under any implementation, because it does
not run on the machine whose security state it would need to read.**

This is the same shape of problem FORGE Capture already solved: a browser/
hosted app fundamentally cannot provide certain OS-level capabilities
(global shortcuts, system-wide screen capture), so FORGE Capture's own
Rung 0 concluded a standalone local shell is the primary product, with the
browser-based editor living inside it (see `docs/product/forge-capture/RUNG0_ADR.md`,
ADR-CAP-001). FORGE Security's collector needs is a stronger version of the
same fact: WMI, the registry, the Windows Event Log, and local process/socket
enumeration are not reachable from a cloud-hosted request handler at all,
not just harder to reach from a browser tab.

## Options considered

1. **Privileged monitoring "from" the Next.js web app.** Rejected as stated
   above — not reachable from the production Vercel deployment. The only way
   to make this phrase mean anything is running marketplace409 in local dev
   mode on Jason's own workstation and adding a collector API route to that
   local dev server. Rejected anyway: it would tie a security tool's uptime
   to a web app's dev-server lifecycle, contradicts "keep isolated from
   [other] implementation work," and a `next dev` process is not a
   trustworthy or intended way to host anything persistent.
2. **A separate native/local Windows agent** (a small standalone process —
   PowerShell-driven scheduled task to start, a compiled service later if
   event-driven collection needs it) that runs entirely on the monitored
   machine, collects via the mechanisms in [`windows-sources.md`](./windows-sources.md),
   and writes to a local evidence store. This is the only option that can
   actually read the sources this product needs.

## Decision

- **A separate native/local agent is the collector**, not the existing
  Next.js web app. This is consistent with ADR-002's local-first mandate and
  with the plain fact that only a process running on Jason's workstation can
  read that workstation's security state.
- For Rung 1 specifically (the *minimum* local status collector), start with
  the simplest viable technology: a PowerShell/.NET-based collector invoked
  by a Windows Scheduled Task, writing to a local file/SQLite store. This
  needs no new build/signing pipeline and no new runtime to install, which
  matches "no new paid service" and Rung 1's own "minimum" framing.
- Revisit a long-running compiled service (Go/Rust/C#) only if Rung 3's
  event-driven sources (Event Log subscriptions, `FileSystemWatcher`) prove
  that scheduled-task polling has unacceptable latency for the threats that
  need it (e.g., "Defender just got disabled" is exactly the kind of thing
  that benefits from event-driven, near-real-time collection rather than a
  polling interval). That decision belongs to Rung 3's own proposal, not this
  one — Rung 1 should not over-build for a need it hasn't confirmed yet.

## UI locality — resolved 2026-09-30 (was an open question; see git history for the original framing)

The assignment's Rung 4 says "Build the authenticated FORGE UI/read path" for
the dashboard, which reads naturally as *the existing marketplace409 web app*
gaining a Security section. But ADR-002 commits to local-first, no
third-party telemetry — and marketplace409's web app is Vercel-hosted, not
local. Those two statements were in tension for exactly one thing: **how
does Jason view the dashboard?**

Two resolutions were considered:

- **(a) Local-only UI:** the local agent itself serves a small UI bound to
  `127.0.0.1` (or a lightweight local desktop shell, reusing the FORGE
  Capture precedent of a standalone local utility). Fully consistent with
  ADR-002. Cost: a second, separate UI surface outside the main FORGE app; no
  remote viewing until Rung 8 deliberately threat-models a sync/remote-access
  channel.
- **(b) Integrated into the existing FORGE web app:** the local agent
  periodically pushes evidence metadata to marketplace409's existing backend
  so it renders in the same app Jason already uses for Rental/Scheduling/
  Designer. This would have meant reopening the cross-machine data-movement
  boundary ADR-002 defers to Rung 8, four rungs early.

**Decision (ChatGPT review of PR #493, finding 1):** option **(a)**. For
Rungs 1–7, the FORGE Security dashboard is local-only, bound to loopback or
presented as a local desktop shell — never a module of the hosted
marketplace409 app, never sharing its auth session, never sending evidence to
it. It may reuse FORGE's visual design conventions. Remote/integrated viewing
inside the main FORGE app is a Rung 8 decision only, made after that rung's
own dedicated sync/control-channel threat model. [`architecture.md`](./architecture.md#the-rung-4-ui-is-local-only-not-the-hosted-forge-app),
[`ux-specification.md`](./ux-specification.md), and
[`product-ladder.md`](./product-ladder.md#rung-4--forge-security-dashboard)
all reflect this same corrected boundary.

## Consequences

- Rung 1 has a concrete, low-commitment starting technology (scheduled-task
  PowerShell collector) that doesn't foreclose a later compiled-service
  rewrite if Rung 3 needs it.
- Rung 4 is scoped as a local-only UI from the start — no design work should
  assume hosted-app integration, auth reuse, or remote access before Rung 8.
- No signing/distribution decision is made here; that only matters once a
  compiled agent exists (post-Rung-1), matching FORGE Capture's own
  precedent of deferring the code-signing decision until its Tauri shell
  rung.
