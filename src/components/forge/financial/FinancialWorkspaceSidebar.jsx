import ForgeRecentActivity from "@/components/forge/ForgeRecentActivity";
import ForgeSystemStatus from "@/components/forge/ForgeSystemStatus";
import FinancialOperationsPanel from "@/components/forge/financial/FinancialOperationsPanel";
import { forgeTheme } from "@/components/forge/theme";

const defaultGuardrails = Object.freeze([
  "Rental portfolio activity is now displayed from persisted financial events.",
  "Plaid, brokerage, valuation, and Stripe integrations remain behind the provider boundary.",
  "Financial calculations stay in the domain layer, not React components.",
]);

export default function FinancialWorkspaceSidebar({
  statusItems = [],
  activities = [],
  operations = {},
  guardrails = defaultGuardrails,
}) {
  return (
    <div
      data-financial-workspace-sidebar
      className="space-y-6"
    >
      <ForgeSystemStatus statusItems={statusItems} />

      <ForgeRecentActivity activities={activities} />

      <FinancialOperationsPanel
        focus={operations.focus}
        summary={operations.summary}
        priority={operations.priority}
        actions={operations.actions}
      />

      <section
        data-financial-phase-guardrails
        className={forgeTheme.cardCompact}
      >
        <div className={forgeTheme.labelSmall}>
          Phase Guardrails
        </div>

        <div className="mt-3 space-y-3 text-sm text-slate-600">
          {guardrails.map((guardrail) => (
            <p key={guardrail}>{guardrail}</p>
          ))}
        </div>
      </section>
    </div>
  );
}
