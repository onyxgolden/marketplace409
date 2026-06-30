export default function HomeCrossPosting() {
  return (
    <section className="max-w-6xl mx-auto py-10 px-6">
      <div className="bg-blue-900 text-white rounded-3xl p-4 shadow-lg">
        <p className="text-sm uppercase tracking-wide text-blue-200 mb-2">
          Seller Tool
        </p>

        <h3 className="text-xl font-bold mb-2">Easy Cross Posting</h3>

        <p className="text-sm text-blue-100 mb-6">
          Already posted on Facebook, Craigslist, or OfferUp? Paste your
          listing, upload screenshots, and let 409 Marketplace help clean it
          up for local buyers.
        </p>

        <div className="flex flex-col md:flex-row gap-4">
          <input
            className="flex-1 rounded-xl px-4 py-3 text-gray-900"
            placeholder="Paste listing text or link here..."
          />

          <a
            href="/import"
            className="bg-red-600 px-6 py-3 rounded-xl font-bold hover:bg-red-500"
          >
            Import Listing
          </a>
        </div>
      </div>
    </section>
  );
}
