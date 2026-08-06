import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "@/components/forge/ForgeSystemStatus",
  () => ({
    default: function MockForgeSystemStatus({
      statusItems = [],
    }) {
      return (
        <section data-forge-system-status>
          <div>System Status</div>
          {statusItems.map((item) => (
            <div key={item.label}>
              {item.label} · {item.detail} · {item.value}
            </div>
          ))}
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeRecentActivity",
  () => ({
    default: function MockForgeRecentActivity({
      activities = [],
    }) {
      return (
        <section data-forge-recent-activity>
          <div>Recent Activity</div>
          {activities.length === 0 ? (
            <div>No recent activity.</div>
          ) : (
            activities.map((activity) => (
              <div key={activity.id}>
                {activity.label} · {activity.detail} ·{" "}
                {activity.type} · {activity.timestamp}
              </div>
            ))
          )}
        </section>
      );
    },
  }),
);

import FinancialWorkspaceSidebar from "../FinancialWorkspaceSidebar.jsx";

describe("FinancialWorkspaceSidebar", () => {
  it("composes presentation-ready financial workspace context", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSidebar
        statusItems={[
          {
            label: "Financial Engine",
            detail: "Domain calculations available.",
            value: "Online",
          },
        ]}
        activities={[
          {
            id: "activity-1",
            label: "Import completed",
            detail: "Transactions are ready for review.",
            type: "Import",
            timestamp: "Today",
          },
        ]}
        operations={{
          focus: "Protect operating cash",
          summary: "Review near-term obligations.",
          priority: "high",
          actions: [
            {
              id: "action-1",
              title: "Review receivables",
              status: "recommended",
              priority: "high",
              rationale: "Collections are behind plan.",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain(
      "data-financial-workspace-sidebar",
    );
    expect(markup).toContain("System Status");
    expect(markup).toContain("Financial Engine");
    expect(markup).toContain("Recent Activity");
    expect(markup).toContain("Import completed");
    expect(markup).toContain(
      "data-financial-operations-panel",
    );
    expect(markup).toContain("Protect operating cash");
    expect(markup).toContain(
      "data-financial-phase-guardrails",
    );
    expect(markup).toContain("Phase Guardrails");
    expect(markup).toContain(
      "Financial calculations stay in the domain layer, not React components.",
    );
  });

  it("provides stable loading and empty presentation states", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSidebar />,
    );

    expect(markup).toContain(
      "data-financial-workspace-sidebar",
    );
    expect(markup).toContain("No recent activity.");
    expect(markup).toContain("Operations Plan");
    expect(markup).toContain(
      "Financial operations guidance is loading.",
    );
    expect(markup).toContain(
      "No financial operations actions are available yet.",
    );
    expect(markup).toContain(
      "Rental portfolio activity is now displayed from persisted financial events.",
    );
  });

  it("accepts presentation-ready guardrails", () => {
    const markup = renderToStaticMarkup(
      <FinancialWorkspaceSidebar
        guardrails={[
          "Embedded financial context remains read-only.",
        ]}
      />,
    );

    expect(markup).toContain(
      "Embedded financial context remains read-only.",
    );
    expect(markup).not.toContain(
      "Plaid, brokerage, valuation, and Stripe integrations remain behind the provider boundary.",
    );
  });
});
