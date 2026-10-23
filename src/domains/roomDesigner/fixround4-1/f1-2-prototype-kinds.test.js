// F1.2 probe (PR #668 fix round 4.1) — prototype-named owner kinds
// crash validation. Found by the local panel chair at head 6fc6d47d:
// normalizeOwnerRef resolves its schema as OWNER_REF_SCHEMAS[ref.kind]
// on a plain object, so a kind naming an inherited Object.prototype
// member ("constructor", "__proto__", "toString", "hasOwnProperty",
// "valueOf") resolves a truthy non-array value and the function
// throws `TypeError: fields.includes is not a function` instead of
// returning null. A persisted reducer portOwners ref of such a kind
// makes reducerErrors and validateDesign THROW — defeating the F1.1
// contract that malformed persisted references are REPORTED as
// malformed (fail-by-crash instead of fail-closed).
//
// These probes FAIL against the round-4 implementation and must PASS
// after the fix: the schema lookup is prototype-safe, every unknown
// kind returns null, nothing throws, nothing binds, and the persisted
// path reports the named malformed-reference error — including after
// a serializeDesign/parseDesign round trip.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  parseDesign,
  placeSymbol,
  resetDesignerIds,
  serializeDesign,
  validateDesign,
} from "../designerDocument";
import {
  normalizeOwnerRef,
  ownerPairKey,
  reducerErrors,
  reducerOwnerKey,
  reducerOwnersEqual,
} from "../pipeReducerModel";

beforeEach(() => {
  resetDesignerIds();
});

const PROTOTYPE_KINDS = [
  "constructor",
  "__proto__",
  "toString",
  "hasOwnProperty",
  "valueOf",
];

const VALID_REF = { kind: "run-end", runId: "r", end: "start" };

describe("F1.2 prototype-named owner kinds refuse at unit level", () => {
  it.each(PROTOTYPE_KINDS)(
    "kind %s: null key, no equality, no pair key, never throws",
    (kind) => {
      // The panel's persisted shape, plus a bare-kind variant.
      for (const ref of [{ kind, runId: "r", end: "start" }, { kind }]) {
        expect(() => normalizeOwnerRef(ref)).not.toThrow();
        expect(normalizeOwnerRef(ref)).toBeNull();
        expect(reducerOwnerKey(ref)).toBeNull();
        expect(reducerOwnersEqual(ref, ref)).toBe(false);
        expect(reducerOwnersEqual(ref, VALID_REF)).toBe(false);
        expect(reducerOwnersEqual(VALID_REF, ref)).toBe(false);
        expect(ownerPairKey(ref, VALID_REF)).toBeNull();
        expect(ownerPairKey(VALID_REF, ref)).toBeNull();
      }
      // The valid reference still keys normally alongside the probe.
      expect(reducerOwnerKey(VALID_REF)).not.toBeNull();
      expect(reducerOwnersEqual(VALID_REF, { ...VALID_REF })).toBe(true);
    },
  );
});

/**
 * A reducer instance carrying a persisted portOwners ref of the
 * given kind on its inlet port — the public persisted-document path
 * from the panel's executed counterexample.
 */
function designWithPersistedOwnerKind(kind) {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 200, y: 0 }], {
    id: "h",
    diameterIn: 2,
    elevationIn: 150,
  });
  design = placeSymbol(design, "piping", "reducer", 50, 0, { id: "red" });
  design = {
    ...design,
    symbols: design.symbols.map((s) =>
      s.id === "red"
        ? {
            ...s,
            inletSizeIn: 2,
            outletSizeIn: 1,
            elevationIn: 150,
            portOwners: {
              inlet: { kind, runId: "r", end: "start" },
              outlet: { kind: "run-end", runId: "h", end: "end" },
            },
          }
        : s,
    ),
  };
  return design;
}

describe("F1.2 prototype-named kinds are reported malformed, never thrown", () => {
  it.each(PROTOTYPE_KINDS)(
    "kind %s: reducerErrors and validateDesign report malformed, no throw",
    (kind) => {
      const design = designWithPersistedOwnerKind(kind);
      let errors;
      expect(() => {
        errors = reducerErrors(design);
      }).not.toThrow();
      expect(
        errors.some((e) => e.includes("red") && /malformed/i.test(e)),
      ).toBe(true);

      let validation;
      expect(() => {
        validation = validateDesign(design);
      }).not.toThrow();
      expect(
        validation.some((e) => e.includes("red") && /malformed/i.test(e)),
      ).toBe(true);

      // The refusal survives a save/reload round trip.
      const reloaded = parseDesign(serializeDesign(design));
      let reloadedErrors;
      expect(() => {
        reloadedErrors = reducerErrors(reloaded);
      }).not.toThrow();
      expect(
        reloadedErrors.some((e) => e.includes("red") && /malformed/i.test(e)),
      ).toBe(true);
      expect(() => validateDesign(reloaded)).not.toThrow();
    },
  );
});
