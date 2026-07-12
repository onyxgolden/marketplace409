# FORGE Shadow Governance

## Status

**Experimental**

This directory contains governance documents maintained by the FORGE Governance Synchronizer during its evaluation period.

These documents are not authoritative FORGE governance sources.

If any shadow governance document conflicts with an authoritative governance document, the authoritative governance document wins.

## Authoritative Governance Documents

The authoritative governance documents remain:

* `docs/architecture/FORGE_ENGINEERING_CONTROL_CENTER.md`
* `docs/architecture/FORGE_STATUS.md`
* `docs/architecture/FORGE_SESSION.md`
* `docs/architecture/FORGE_ROADMAP.md`

The synchronizer must not modify those documents during the shadow evaluation period.

## Shadow Documents

The synchronizer will maintain experimental equivalents:

* `FORGE_SYNC_CONTROL_CENTER.md`
* `FORGE_SYNC_STATUS.md`
* `FORGE_SYNC_SESSION.md`
* `FORGE_SYNC_ROADMAP.md`
* `FORGE_SYNC_EVALUATION.md`

## Purpose

The shadow governance system exists to test whether a deterministic governance synchronizer can:

* Record verified repository state accurately.
* Record completed work without overstating capability.
* Maintain consistent phase and objective information.
* Preserve historical architectural meaning.
* Avoid unauthorized governance changes.
* Produce useful next-session context.
* Distinguish repository evidence from architectural interpretation.

## Evaluation Model

The authoritative governance documents will continue to be maintained through the existing human-reviewed process.

The synchronizer will independently update the shadow documents from the same verified repository evidence.

The shadow results will then be compared against the authoritative governance state.

Each shadow document will be evaluated independently.

Successful performance in one document does not grant authority over another document.

Authority may eventually be granted at the section level rather than the whole-document level.

## Authority Rules

During the evaluation period:

* Shadow documents have no governance authority.
* The synchronizer may modify only files explicitly assigned to it.
* Protected rules remain human-controlled.
* Architectural direction remains human-controlled.
* Phase creation and phase naming remain human-controlled.
* Active objective selection remains human-controlled unless explicitly delegated.
* The synchronizer must never commit or push automatically.
* Repository inspection must precede synchronization.
* Repository evidence overrides documentation claims.
* Unverified work must never be marked complete.

## Promotion Requirements

A document or section may be considered for synchronizer control only after repeated successful trials.

Promotion requires:

* No protected-rule mutations.
* No invented completion claims.
* No unsupported architectural claims.
* No loss of important historical context.
* Correct behavior when implementation is incomplete.
* Correct repository health reporting.
* Consistency with authoritative governance.
* Explicit owner approval.

A serious factual or governance failure resets the evaluation period for the affected document or section.

## Guiding Principle

The synchronizer records verified engineering reality.

It does not create engineering reality, redefine governance, or choose architectural direction without explicit authority.
