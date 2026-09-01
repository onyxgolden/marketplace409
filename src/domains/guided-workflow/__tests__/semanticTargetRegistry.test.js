import { describe, expect, it } from "vitest";
import { createSemanticTargetRegistry, resolveSemanticTarget } from "../semanticTargetRegistry.js";
import { MalformedGuidedWorkflowContractError } from "../guidedWorkflowContracts.js";

describe("createSemanticTargetRegistry", () => {
  it("builds a registry from well-formed targets", () => {
    const registry = createSemanticTargetRegistry([
      { targetId: "rental.attention.overdue-forge", description: "Overdue rent attention item" },
      { targetId: "rental.attention.vacancies", description: "Vacancies attention item" },
    ]);
    expect(registry.has("rental.attention.overdue-forge")).toBe(true);
    expect(registry.list()).toHaveLength(2);
  });

  it("fails closed on a duplicate targetId -- an authoring mistake, not a runtime case", () => {
    expect(() => createSemanticTargetRegistry([
      { targetId: "dup", description: "first" },
      { targetId: "dup", description: "second" },
    ])).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("fails closed on a malformed target entry", () => {
    expect(() => createSemanticTargetRegistry([{ targetId: "x" }])).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("fails closed when targets is not an array", () => {
    expect(() => createSemanticTargetRegistry(null)).toThrow(MalformedGuidedWorkflowContractError);
  });

  it("builds an empty registry from an empty array", () => {
    const registry = createSemanticTargetRegistry([]);
    expect(registry.list()).toEqual([]);
  });
});

describe("resolveSemanticTarget", () => {
  const registry = createSemanticTargetRegistry([
    { targetId: "rental.attention.overdue-forge", description: "Overdue rent attention item" },
  ]);

  it("resolves a real target", () => {
    const result = resolveSemanticTarget(registry, "rental.attention.overdue-forge");
    expect(result.found).toBe(true);
    expect(result.target.targetId).toBe("rental.attention.overdue-forge");
  });

  it("returns a safe not-found result for a missing target instead of throwing", () => {
    const result = resolveSemanticTarget(registry, "rental.attention.nonexistent");
    expect(result.found).toBe(false);
    expect(result.reason).toBe("missing_target");
    expect(result.target).toBeNull();
  });

  it("returns a safe result for an invalid target id rather than throwing", () => {
    expect(resolveSemanticTarget(registry, "").found).toBe(false);
    expect(resolveSemanticTarget(registry, null).found).toBe(false);
  });

  it("returns a safe result for an invalid registry rather than throwing", () => {
    const result = resolveSemanticTarget(null, "anything");
    expect(result.found).toBe(false);
    expect(result.reason).toBe("invalid_registry");
  });
});
