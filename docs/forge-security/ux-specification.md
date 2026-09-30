# First dashboard specification (assignment section F)

Specified only — not implemented. This is what Rung 4 builds, once Rungs 1–3
give it real evidence to render. Wireframes are described in words/structure,
not built as components yet.

## Overall layout

A single FORGE Security home screen, reachable like any other FORGE module
(alongside Rental/Scheduling/Designer), with these regions:

### 1. Overall machine protection status (top banner)

The single most important thing Jason should see at a glance: the current
worst unresolved severity band across all active evidence, plus a short
per-category summary (Defender / Firewall / Updates each shown as
protected / attention / unprotected / **unknown**). `unknown` is a first-class
visual state — distinct from "protected," never collapsed into it — for any
category where the most recent collection did not succeed
(see the [privacy contract](./privacy-data-contract.md#unknown-is-not-healthy--a-data-contract-not-just-a-ux-rule)).

### 2. Defender / Firewall / Updates panel

Three compact status cards, each showing: current state, when it was last
successfully checked, and — if the state changed recently — when and to
what. Each card links to the underlying evidence records behind it (§7).

### 3. Recent security events

A reverse-chronological list of evidence at `attention` band or above (not
every `informational` event by default — that list would be noisy; those
remain visible via a filter, not deleted). Each row: severity, event type in
plain language, timestamp, source. Clicking a row opens the evidence detail
view (§7).

### 4. Persistence changes

New/changed startup entries, scheduled tasks, and services since the
established baseline, with first-observation vs. genuine-change visually
distinguished (per the [severity model](./severity-rules.md#rules-for-building-the-real-rule-table-rung-13)'s
baseline rule).

### 5. Accounts / admin changes

New local accounts and Administrators-group membership changes, oldest-first
or newest-first per Jason's preference — a small, focused list, not folded
into the generic event feed, because account/privilege changes deserve their
own visual weight.

### 6. Network exposure

Currently-listening sockets that aren't loopback-only, each with owning
process, signature state, and first-seen time; a smaller "changed since
yesterday" callout above the full list.

### 7. Critical file integrity

Status of the allowlisted path set: last verified time, current hash vs.
baseline hash, and a clear "no files are being watched yet" empty state
rather than implying broad coverage that doesn't exist.

### 8. Machine inventory

One row per enrolled machine (meaningful even at Rung 1 with a single
machine, and directly reusable at Rung 8): OS build, agent/collector version,
last successful check-in, overall status.

### 9. Evidence detail view — "Why am I seeing this?"

Every event opens into a detail view showing, verbatim from the schema:
`event_type`, `severity` next to `raw_os_severity`/`raw_os_state`
side-by-side (never merged into one field — see §3 of the privacy contract),
`rule_id` and `rule_explanation`, every identifier field the event carries
(process/service/task/account/path/hash/signer/port), and
`evidence_provenance`. This view is the concrete answer to "why am I seeing
this" the assignment asks for — it is not a summary, it is the record.

Once Rung 5 exists, a Brain-generated explanation may appear as an
**additional, clearly-labeled** panel below the raw evidence — visually and
structurally distinct from the deterministic fields above it, never
replacing them.

### 10. OS-reported detection vs. FORGE-generated rule alert (cross-cutting)

Everywhere severity is shown, the UI must visually distinguish two kinds of
event:

- **OS-reported detection** — e.g. Defender found and handled malware. FORGE
  Security is relaying something the OS already decided.
- **FORGE-generated rule alert** — e.g. "a new admin account appeared." FORGE
  Security's own deterministic rule produced this judgment from raw state.

This distinction should be a small, consistent badge/label pattern used in
the recent-events list, the category panels, and the detail view — not just
documented in prose here and then left to implementation discretion.

## Explicitly not part of Rung 4

- No response/remediation controls anywhere in this dashboard (Rung 6 gets
  its own UX spec when it's proposed, with its own confirmation-flow design).
- No natural-language query box — that's Rung 5's read-only Brain layer, and
  even then it answers into this same evidence-detail vocabulary, not a
  freeform chat replacing the structured views above.
