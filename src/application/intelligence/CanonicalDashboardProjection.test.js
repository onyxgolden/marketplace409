import { describe, expect, it } from "vitest";
import { CanonicalDashboardProjection } from "./CanonicalDashboardProjection.js";

describe("CanonicalDashboardProjection", () => {
  it("projects canonical financial intelligence into dashboard shape", () => {
    const result =
      CanonicalDashboardProjection.project({
        financial: {
          position: {
            assets: [
              {
                name: "Cash",
                value: 100,
              },
            ],
            liabilities: [
              {
                name: "Credit Card",
                balance: 25,
              },
            ],
          },
        },
      });

    expect(result.netWorth).toEqual({
      totalAssets: 100,
      totalLiabilities: 25,
      netWorth: 75,
      debtToAssetRatio: 0.25,
    });

    expect(result.auditFindings).toEqual({
      anomalies: [],
    });

    expect(result.riskDashboard.summary.status).toBe(
      "Ready",
    );
  });

  it("handles missing canonical position safely", () => {
    const result =
      CanonicalDashboardProjection.project();

    expect(result.netWorth).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      debtToAssetRatio: 0,
    });
  });
});
