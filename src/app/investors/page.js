import Header from "@/components/Header";

export const dynamic = "force-dynamic";

export default function InvestorsPage() {
  const investorTools = [
    {
      href: "/investors/properties",
      icon: "🏠",
      title: "Investment Properties",
      description: "Browse rentals, rehab projects, wholesale deals, and investment opportunities.",
      badge: "Deals",
    },
    {
      href: "/investors/cash-buyers",
      icon: "💵",
      title: "Cash Buyer Directory",
      description: "Find local buyers looking for flips, rentals, land, and off-market deals.",
      badge: "New",
    },
    {
      href: "/investors/wholesalers",
      icon: "🤝",
      title: "Wholesaler Directory",
      description: "Local wholesalers, bird dogs, deal finders, and investor contacts.",
      badge: "Filtered",
    },
    {
      href: "/investors/documents",
      icon: "📄",
      title: "Free Investor Documents",
      description: "Download contracts, worksheets, checklists, and deal analysis templates.",
      badge: "Free",
    },
    {
      href: "/investors/rehab-estimator",
      icon: "🧮",
      title: "Rehab Estimator",
      description: "Estimate repair costs before buying your next investment property.",
      badge: "Tool",
    },
    {
      href: "/investors/contractors",
      icon: "🔨",
      title: "409 Contractors",
      description: "Find local contractors and rehab professionals for investor projects.",
      badge: "Local",
    },
    {
      href: "/investors/add-property",
      icon: "➕",
      title: "Add Property",
      description: "Post a rental, wholesale deal, rehab project, or investment opportunity.",
      badge: "Post",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-green-900 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">
            🏘 409 Real Estate Investors
          </h1>

          <p className="text-xl text-green-100 max-w-4xl">
            Deals, cash buyers, wholesalers, rehab tools, contractors, and free
            investor documents for Southeast Texas.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="mb-8">
          <h2 className="text-3xl font-extrabold mb-2">Investor Tools</h2>
          <p className="text-gray-600">
            Start here if you're buying, selling, wholesaling, rehabbing, or
            analyzing local investment property.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {investorTools.map((tool) => (
            <a
              key={tool.href}
              href={tool.href}
              className="bg-white rounded-3xl shadow-md p-6 hover:shadow-xl border border-gray-100"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="text-5xl">{tool.icon}</div>

                <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-900">
                  {tool.badge}
                </span>
              </div>

              <h3 className="text-2xl font-bold mb-2">{tool.title}</h3>

              <p className="text-gray-600">{tool.description}</p>
<div className="mt-5">
  <span className="inline-block rounded-xl bg-green-700 px-4 py-2 font-bold text-white">
    Open {tool.title}
  </span>
</div>

            </a>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto pb-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <h2 className="text-3xl font-extrabold mb-3">
            Quick Investor Workflow
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <div className="rounded-2xl bg-gray-100 p-5">
              <div className="text-3xl mb-2">1️⃣</div>
              <h3 className="font-bold mb-1">Find a Deal</h3>
              <p className="text-sm text-gray-600">
                Browse properties or connect with wholesalers.
              </p>
            </div>

            <div className="rounded-2xl bg-gray-100 p-5">
              <div className="text-3xl mb-2">2️⃣</div>
              <h3 className="font-bold mb-1">Analyze It</h3>
              <p className="text-sm text-gray-600">
                Use documents and the rehab estimator before making an offer.
              </p>
            </div>

            <div className="rounded-2xl bg-gray-100 p-5">
              <div className="text-3xl mb-2">3️⃣</div>
              <h3 className="font-bold mb-1">Find Buyers</h3>
              <p className="text-sm text-gray-600">
                Use the cash buyer directory if you're wholesaling or assigning.
              </p>
            </div>

            <div className="rounded-2xl bg-gray-100 p-5">
              <div className="text-3xl mb-2">4️⃣</div>
              <h3 className="font-bold mb-1">Get It Done</h3>
              <p className="text-sm text-gray-600">
                Find contractors and track your rehab scope.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto pb-16 px-6">
        <h2 className="text-3xl font-bold mb-6">🏛 County Property Resources</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <a
            href="https://esearch.orangecad.net/"
            target="_blank"
            rel="noreferrer"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-4xl mb-3">🏠</div>
            <h3 className="text-xl font-bold">Orange County Property Search</h3>
            <p className="text-gray-600 mt-2">
              Search Orange County property records by owner, address, or
              property ID.
            </p>
          </a>

          <a
            href="https://esearch.jcad.org/"
            target="_blank"
            rel="noreferrer"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-4xl mb-3">🏘️</div>
            <h3 className="text-xl font-bold">
              Jefferson County Property Search
            </h3>
            <p className="text-gray-600 mt-2">
              Search Jefferson County property records by owner, address, or ID.
            </p>
          </a>

          <a
            href="https://jeffcotax.com/"
            target="_blank"
            rel="noreferrer"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-4xl mb-3">💵</div>
            <h3 className="text-xl font-bold">Jefferson County Tax Office</h3>
            <p className="text-gray-600 mt-2">
              Property tax information and payment records.
            </p>
          </a>
        </div>
      </section>
    </main>
  );
}