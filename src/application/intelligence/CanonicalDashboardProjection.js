import { NetWorthService } from "../../domains/networth";

export class CanonicalDashboardProjection {
  static project(context = {}) {
    const position =
      context?.financial?.position || {};

    const netWorth =
      NetWorthService.calculate(
        Array.isArray(position.assets)
          ? position.assets
          : [],
        Array.isArray(position.liabilities)
          ? position.liabilities
          : [],
      );

    return {
      auditFindings: {
        anomalies: [],
      },

      riskDashboard: {
        summary: {
          status: "Ready",
          summary: "Dashboard intelligence is ready.",
        },
      },

      netWorth,
    };
  }
}

Object.freeze(CanonicalDashboardProjection);
