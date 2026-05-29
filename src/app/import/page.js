import Header from "@/components/Header";
export default function ImportPage() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-4xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">
          Import Existing Listing
        </h1>

        <p className="text-xl text-gray-600 mb-8">
          Paste a Facebook, Craigslist, OfferUp, or plain-text listing. Later,
          AI will help clean it up and prepare it for 409 Marketplace.
        </p>

        <div className="bg-white rounded-3xl shadow-xl p-8">
          <label className="font-bold text-lg">Listing Link or Text</label>

          <textarea
            className="w-full border rounded-xl px-4 py-4 h-56 mt-3 mb-6"
            placeholder="Paste listing link, description, or screenshot notes here..."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <input
              className="border rounded-xl px-4 py-4"
              placeholder="Seller city or ZIP"
            />

            <select className="border rounded-xl px-4 py-4">
              <option>Original platform</option>
              <option>Facebook Marketplace</option>
              <option>Craigslist</option>
              <option>OfferUp</option>
              <option>Other</option>
            </select>
          </div>

          <button className="w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold hover:bg-blue-800">
            Clean Up Listing
          </button>

          <p className="text-sm text-gray-500 mt-4">
            This is user-assisted importing only. We are not scraping other
            platforms.
          </p>
        </div>
      </section>
    </main>
  );
}