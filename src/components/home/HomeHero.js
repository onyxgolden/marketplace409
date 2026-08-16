import { PawPrint, Search, Shield, Home as HomeIcon, Wheat } from "lucide-react";

export default function HomeHero() {
  return (
    <section className="relative py-24 px-6 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800"></div>

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

        <p className="text-xl text-slate-300 mb-6">
          Buy Local. Sell Local. Support Community.
        </p>

        <div className="flex flex-wrap justify-center gap-3 mb-8">
          <span className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white px-4 py-2 rounded-full font-semibold">
            🇺🇸 Made in USA
          </span>
          <span className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white px-4 py-2 rounded-full font-semibold">
            <Shield aria-hidden="true" className="h-4 w-4" />
            Veteran Owned
          </span>
          <span className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white px-4 py-2 rounded-full font-semibold">
            <Wheat aria-hidden="true" className="h-4 w-4" />
            Local Farms
          </span>
          <span className="flex items-center gap-1.5 bg-white/10 border border-white/15 text-white px-4 py-2 rounded-full font-semibold">
            <HomeIcon aria-hidden="true" className="h-4 w-4" />
            Local Rentals
          </span>
          <span className="flex items-center gap-1.5 bg-amber-400 text-slate-950 px-4 py-2 rounded-full font-semibold">
            <PawPrint aria-hidden="true" className="h-4 w-4" />
            Community Pets
          </span>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-4 max-w-4xl mx-auto mb-10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              className="border rounded-xl px-4 py-3 text-slate-900"
              placeholder="What are you looking for?"
            />

            <input
              className="border rounded-xl px-4 py-3 text-slate-900"
              placeholder="City or ZIP"
            />

            <select className="border rounded-xl px-4 py-3 text-slate-900">
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

            <button className="flex items-center justify-center gap-2 bg-amber-500 text-slate-950 rounded-xl font-bold hover:bg-amber-400">
              <Search aria-hidden="true" className="h-4 w-4" />
              Search
            </button>
          </div>
        </div>

        <div className="flex justify-center gap-4">
          <a
            href="/browse"
            className="bg-white text-slate-950 px-6 py-3 rounded-xl text-lg font-semibold hover:bg-slate-100"
          >
            Browse Listings
          </a>

          <a
            href="/post"
            className="bg-amber-500 text-slate-950 px-6 py-3 rounded-xl text-lg font-semibold hover:bg-amber-400"
          >
            Post Listing
          </a>
        </div>
      </div>
    </section>
  );
}
