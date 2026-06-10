import Header from "@/components/Header";

export const dynamic = "force-dynamic";

export default function InvestorsPage() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-green-900 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">
            🏘 409 Real Estate Investors
          </h1>

          <p className="text-xl text-green-100">
            Deals, rentals, rehab projects, contractors, and investor tools for
            Southeast Texas.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <a
            href="/investors/properties"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-5xl mb-4">🏠</div>
            <h3 className="text-xl font-bold mb-2">Investment Properties</h3>

            <p className="text-gray-600">
              Browse rentals, rehab projects, and investment opportunities.
            </p>
          </a>

          <a
            href="/investors/add-property"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-5xl mb-4">➕</div>
            <h3 className="text-xl font-bold mb-2">Add Property</h3>

            <p className="text-gray-600">
              Post a rental, wholesale deal, or rehab opportunity.
            </p>
          </a>

          <a
            href="/investors/rehab-estimator"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-5xl mb-4">🧮</div>
            <h3 className="text-xl font-bold mb-2">Rehab Estimator</h3>

            <p className="text-gray-600">
              Estimate repair costs for your next deal.
            </p>
          </a>

          <a
            href="/investors/contractors"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-5xl mb-4">🔨</div>
            <h3 className="text-xl font-bold mb-2">409 Contractors</h3>

            <p className="text-gray-600">
              Find local contractors and rehab professionals.
            </p>
          </a>
          <a
            href="/investors/documents"
            className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
          >
            <div className="text-5xl mb-4">📄</div>

            <h3 className="text-xl font-bold mb-2">Free Documents</h3>

            <p className="text-gray-600">
              Investor worksheets, checklists, and deal analysis tools.
            </p>
          </a>
        </div>
      </section>
      
      <section className="mt-12">
  <h2 className="text-3xl font-bold mb-6">
    🏛 County Property Resources
  </h2>

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
    Search Orange County property records by owner, address, or property ID.
  </p>
</a>

    <a
  href="https://esearch.jcad.org/"
  target="_blank"
  rel="noreferrer"
  className="bg-white rounded-2xl shadow-md p-6 hover:shadow-xl"
>
  <div className="text-4xl mb-3">🏘️</div>
  <h3 className="text-xl font-bold">Jefferson County Property Search</h3>
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
