import Header from "@/components/Header";
import { NetWorthService } from "@/domains/networth";

export const dynamic = "force-dynamic";

export default function ForgePage() {
  const assets = [
    { id: "cash", name: "Cash / Bank", category: "cash", value: 280000 },
    { id: "rentals", name: "Rental Portfolio", category: "real_estate", value: 0 },
  ];

  const liabilities = [];

  const summary = NetWorthService.calculate(assets, liabilities);

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-slate-950 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">Financial Forge</h1>
          <p className="text-xl text-slate-300">
            Your personal operating system for net worth, cash flow, assets,
            liabilities, and financial decisions.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl shadow-md p-6">
            <p className="text-gray-500 font-bold">Total Assets</p>
            <h2 className="text-4xl font-extrabold text-green-700">
              ${summary.totalAssets.toLocaleString()}
            </h2>
          </div>

          <div className="bg-white rounded-3xl shadow-md p-6">
            <p className="text-gray-500 font-bold">Total Liabilities</p>
            <h2 className="text-4xl font-extrabold text-red-700">
              ${summary.totalLiabilities.toLocaleString()}
            </h2>
          </div>

          <div className="bg-white rounded-3xl shadow-md p-6">
            <p className="text-gray-500 font-bold">Net Worth</p>
            <h2 className="text-4xl font-extrabold text-blue-900">
              ${summary.netWorth.toLocaleString()}
            </h2>
          </div>
        </div>
      </section>
    </main>
  );
}