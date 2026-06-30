export default function HomeHero() {
  return (
    <section className="relative py-24 px-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-blue-950 via-blue-900 to-red-700 opacity-95"></div>

      <div className="relative max-w-5xl mx-auto text-center text-white">
        <div className="mb-10 rounded-3xl overflow-hidden shadow-2xl border border-white/20">
          <img
            src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1600&auto=format&fit=crop"
            alt="Local Marketplace Community"
            className="w-full h-[350px] object-cover"
          />
        </div>

        <h2 className="text-6xl font-extrabold mb-6 leading-tight">
          Southeast Texas Marketplace
        </h2>

        <p className="text-xl text-blue-100 mb-6">
          Buy Local. Sell Local. Support Community.
        </p>

        <div className="flex flex-wrap justify-center gap-3 mb-8">
          <span className="bg-blue-100 text-blue-900 px-4 py-2 rounded-full font-semibold">
            🇺🇸 Made in USA
          </span>
          <span className="bg-red-100 text-red-700 px-4 py-2 rounded-full font-semibold">
            🛠 Veteran Owned
          </span>
          <span className="bg-green-100 text-green-700 px-4 py-2 rounded-full font-semibold">
            🌽 Local Farms
          </span>
          <span className="bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full font-semibold">
            🏠 Local Rentals
          </span>
          <span className="bg-purple-100 text-purple-800 px-4 py-2 rounded-full font-semibold">
            🐶 Community Pets
          </span>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-4 max-w-4xl mx-auto mb-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              className="border rounded-xl px-4 py-3 text-gray-900"
              placeholder="What are you looking for?"
            />

            <input
              className="border rounded-xl px-4 py-3 text-gray-900"
              placeholder="City or ZIP"
            />

            <select className="border rounded-xl px-4 py-3 text-gray-900">
              <option>All Categories</option>
              <option>Vehicles</option>
              <option>Rentals</option>
              <option>Services</option>
              <option>Farm & Ranch</option>
              <option>Pets</option>
              <option>Electronics</option>
              <option>Music & Instruments</option>
              <option>Boats & Marine</option>
              <option>Hunting & Fishing</option>
              <option value="Tools & Equipment">Tools & Equipment</option>
              <option>Miscellaneous</option>
            </select>

            <button className="bg-red-600 text-white rounded-xl font-bold hover:bg-red-500">
              Search
            </button>
          </div>
        </div>

        <div className="flex justify-center gap-4">
          <a
            href="/browse"
            className="bg-blue-900 text-white px-6 py-3 rounded-xl text-lg font-semibold hover:bg-blue-800"
          >
            Browse Listings
          </a>

          <a
            href="/post"
            className="bg-red-600 text-white px-6 py-3 rounded-xl text-lg font-semibold hover:bg-red-500"
          >
            Post Listing
          </a>
        </div>
      </div>
    </section>
  );
}
