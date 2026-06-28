import Header from "@/components/Header";
import { NetWorthService } from "@/domains/networth";

export const dynamic = "force-dynamic";

function formatCurrency(value) {
  return `$${value.toLocaleString()}`;
}

export default function ForgePage() {
  const assets = [
    { id: "cash", name: "Cash / Bank", category: "cash", value: 280000 },
    {
      id: "rentals",
      name: "Rental Portfolio",
      category: "real_estate",
      value: 0,
    },
  ];

  const liabilities = [];

  const summary = NetWorthService.calculate(assets, liabilities);

  const tools = [
    {
      title: "Financial Import",
      description:
        "Import Rentec or QuickBooks CSV files through the unified financial import facade.",
      href: "/import",
      icon: "📥",
      status: "Production-ready",
    },
    {
      title: "Business Snapshot",
      description:
        "Enter basic business numbers and generate reports from the Forge ledger engine.",
      href: "/financial-snapshot",
      icon: "📊",
      status: "Live tool",
    },
    {
      title: "Financial Reports",
      description:
        "Balance sheet, income statement, and trial balance reporting powered by the ledger.",
      href: "/financial-snapshot",
      icon: "📚",
      status: "Engine online",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-slate-950 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-sm font-bold tracking-[0.3em] text-blue-300 uppercase mb-4">
            Powered by Forge
          </p>

          <h1 className="text-5xl font-extrabold mb-4">Financial Forge</h1>

          <p className="text-xl text-slate-300 max-w-3xl">
            Your personal operating system for imports, net worth, cash flow,
            financial reports, and business decisions.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            label="Total Assets"
            value={formatCurrency(summary.totalAssets)}
            tone="text-green-700"
          />

          <MetricCard
            label="Total Liabilities"
            value={formatCurrency(summary.totalLiabilities)}
            tone="text-red-700"
          />

          <MetricCard
            label="Net Worth"
            value={formatCurrency(summary.netWorth)}
            tone="text-blue-900"
          />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        <div className="mb-8">
          <h2 className="text-3xl font-extrabold mb-3">
            Financial OS Command Center
          </h2>

          <p className="text-gray-600 text-lg">
            Start with imports, run financial snapshots, and review reports from
            the same Forge financial engine.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tools.map((tool) => (
            <a
              key={tool.title}
              href={tool.href}
              className="bg-white rounded-3xl shadow-md p-6 hover:shadow-xl transition block"
            >
              <div className="text-4xl mb-5">{tool.icon}</div>

              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-2xl font-extrabold">{tool.title}</h3>
                <span className="text-xs font-bold bg-blue-100 text-blue-900 px-3 py-1 rounded-full whitespace-nowrap">
                  {tool.status}
                </span>
              </div>

              <p className="text-gray-600 leading-relaxed">
                {tool.description}
              </p>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

function MetricCard({ label, value, tone }) {
  return (
    <div className="bg-white rounded-3xl shadow-md p-6">
      <p className="text-gray-500 font-bold">{label}</p>
      <h2 className={`text-4xl font-extrabold ${tone}`}>{value}</h2>
    </div>
  );
}
