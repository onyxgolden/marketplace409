import Header from "@/components/Header";
import { NetWorthService } from "@/domains/networth";

export const dynamic = "force-dynamic";

function formatCurrency(value) {
  return `$${value.toLocaleString()}`;
}

/**
 * Simple navigation item
 */
function NavItem({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 rounded-xl font-semibold transition ${
        active
          ? "bg-blue-600 text-white"
          : "hover:bg-gray-200 text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Generic panel container
 */
function Panel({ title, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-md p-6">
      <h2 className="text-xl font-bold mb-4">{title}</h2>
      {children}
    </div>
  );
}

/**
 * Metric card
 */
function MetricCard({ label, value, tone }) {
  return (
    <div className="bg-white rounded-3xl shadow-md p-6">
      <p className="text-gray-500 font-bold">{label}</p>
      <h2 className={`text-3xl font-extrabold ${tone}`}>{value}</h2>
    </div>
  );
}

function DashboardView({ summary }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Total Assets"
          value={formatCurrency(summary.totalAssets)}
          tone="text-green-700"
        />
        <MetricCard
          label="Liabilities"
          value={formatCurrency(summary.totalLiabilities)}
          tone="text-red-700"
        />
        <MetricCard
          label="Net Worth"
          value={formatCurrency(summary.netWorth)}
          tone="text-blue-900"
        />
      </div>

      <Panel title="System Status">
        <p className="text-gray-600">
          Financial engine is operational. Ledger, reports, and net worth
          calculations are active.
        </p>
      </Panel>
    </div>
  );
}

function Placeholder({ title }) {
  return (
    <Panel title={title}>
      <p className="text-gray-500">
        This module is initialized but not yet expanded into a full UI.
      </p>
    </Panel>
  );
}

export default function ForgePage() {
  const assets = [
    { id: "cash", name: "Cash / Bank", category: "cash", value: 280000 },
    { id: "rentals", name: "Rental Portfolio", category: "real_estate", value: 0 },
  ];

  const liabilities = [];

  const summary = NetWorthService.calculate(assets, liabilities);

  const [active, setActive] = React.useState("dashboard");

  const nav = [
    "dashboard",
    "reports",
    "ledger",
    "journal",
    "events",
    "replay",
    "audit",
    "compliance",
    "settings",
  ];

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      {/* HERO */}
      <section className="bg-slate-950 text-white py-14 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm tracking-[0.3em] text-blue-300 uppercase mb-3">
            Powered by Forge OS
          </p>

          <h1 className="text-5xl font-extrabold mb-4">
            Financial Command Center
          </h1>

          <p className="text-xl text-slate-300 max-w-3xl">
            Unified view of ledger, reports, events, replay, audit, and
            compliance systems.
          </p>
        </div>
      </section>

      {/* TOP METRICS */}
      <section className="max-w-6xl mx-auto py-10 px-6">
        <DashboardView summary={summary} />
      </section>

      {/* MAIN OS LAYOUT */}
      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* NAV */}
          <div className="space-y-2">
            <Panel title="Navigation">
              {nav.map((item) => (
                <NavItem
                  key={item}
                  active={active === item}
                  onClick={() => setActive(item)}
                >
                  {item.toUpperCase()}
                </NavItem>
              ))}
            </Panel>
          </div>

          {/* WORKSPACE */}
          <div className="md:col-span-3">
            {active === "dashboard" && (
              <DashboardView summary={summary} />
            )}

            {active === "reports" && <Placeholder title="Reports" />}
            {active === "ledger" && <Placeholder title="Ledger" />}
            {active === "journal" && <Placeholder title="Journal" />}
            {active === "events" && <Placeholder title="Events" />}
            {active === "replay" && <Placeholder title="Replay" />}
            {active === "audit" && <Placeholder title="Audit" />}
            {active === "compliance" && <Placeholder title="Compliance" />}
            {active === "settings" && <Placeholder title="Settings" />}
          </div>
        </div>
      </section>
    </main>
  );
}
