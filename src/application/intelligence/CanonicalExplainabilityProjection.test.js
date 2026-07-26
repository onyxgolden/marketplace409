import { describe, expect, it } from "vitest";
import { CanonicalExplainabilityProjection } from "./CanonicalExplainabilityProjection.js";

describe("CanonicalExplainabilityProjection", () => {
  it("projects canonical ledger authority into explainability context", () => {
    const ledger = {
      getEntries: () => [],
    };

    const result =
      CanonicalExplainabilityProjection.project({
        context: {
          provenance: {
            repositoryBacked: true,
          },
        },
        ledger,
      });

    expect(result.type).toBe(
      "canonical-explainability-context",
    );

    expect(result.ledgerContext.ledger).toBe(
      ledger,
    );

    expect(result.provenance.repositoryBacked).toBe(
      true,
    );
  });

  it("handles missing context safely", () => {
    const result =
      CanonicalExplainabilityProjection.project();

    expect(result.type).toBe(
      "canonical-explainability-context",
    );

    expect(result.ledgerContext.ledger).toBeNull();
  });
});
