# ADR 0002 — Scheduling check pack: explicit exclusions

Date: 2026-09-22
Status: Accepted

## Context

Scheduling slice 1 ships the one-click Schedule Check Pack: six immutable
built-in checks (Broken Activities, Gapped Activities, Start Date in Future,
Finish Date in Future, Uncoded, Negative Float) as a dedicated Checks tab in
the scheduling inspector, wired to the existing DCMA functions. The
architecture verdict required the slice's boundaries to be written down so
later slices don't silently expand it.

## Decision

This slice exposes existing schedule-quality functions through a one-click
review surface. It explicitly does **not** do any of the following:

- **No user-defined check views.** The six checks are immutable built-ins;
  there is no saved-view editor, no cloning, no custom filters.
- **No persistent saved layouts.** Check definitions live in code
  (`src/domains/scheduling/schedulingCheckPack.js`); nothing is written to
  the database and there are no migrations.
- **No schedule mutation.** The panel is read-only: selecting a check is
  presentation state only. Contract tests pin this at both the domain and
  component layers (frozen-fixture, no-write assertions).
- **No automated corrective actions.** No auto-remediation, no suggested
  fixes, no root-cause engine, no schedule scoring, no risk scoring.
- **No Guided Workflow execution.** The slice does not import the Guided
  Workflow domain. Each check result carries a slice-4 output contract
  (deterministic `stepId`, named `action`, summary counts, completion
  state) so the guided weekly-update ritual can compose these checks later.
- **No DCMA report replacement.** The checks surface per-activity flags and
  summary counts; they do not reproduce the DCMA 14-point report, baseline
  comparison, PDF report generation, or email/distribution.

The check pack is a presentation mode over existing schedule data, not a
separate application and not a new schedule-quality engine.
