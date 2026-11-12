// pipeTolerances.js — shared pipe tolerance constants (leaf module).
//
// This module has NO imports, by design. The designer domain carries
// a circular import (designerDocument <-> pipeReducerModel) that
// makes module-evaluation order entry-dependent: a top-level const
// copied from a module still mid-evaluation reads undefined under
// Vite's module runner (not a TDZ throw — the check silently passes
// instead of failing). Wiring the D10 aggregates into validateDesign
// (D10-05) exposed this: the face tolerance evaluated to undefined
// and every tolerance-gated access check silently passed. The single
// source for these values lives here so every name in the domain
// reads an already-initialized leaf binding, never a mid-cycle one.
// Do not add imports to this file.

/** Flange-face contact tolerance (in): a run end meets a face when it sits within this. */
export const FACE_TOLERANCE_IN = 0.5;

/** Low-pipe elevation threshold (in): a pipe at or below this is low for walkway headroom. */
export const LOW_PIPE_ELEVATION_IN = 24;
