import { describe, expect, it } from "vitest";
import { canTransitionScreening } from "./screening.js";

// Controls-sweep follow-up G21 (O-10): complete may reopen to in_progress
// for correction; complete is still not re-completable from itself.
describe("screening transitions follow-up G21", () => {
  it("O-10: complete reopens to in_progress", () => {
    expect(canTransitionScreening("complete", "in_progress")).toBe(true);
  });

  it("O-10: the rest of the machine is unchanged", () => {
    expect(canTransitionScreening("complete", "complete")).toBe(false);
    expect(canTransitionScreening("complete", "requested")).toBe(false);
    expect(canTransitionScreening("requested", "complete")).toBe(true);
    expect(canTransitionScreening("in_progress", "complete")).toBe(true);
    expect(canTransitionScreening("requested", "in_progress")).toBe(true);
  });
});
