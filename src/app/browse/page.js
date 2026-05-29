import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default async function BrowsePage({ searchParams }) {
  const params = await searchParams;
  const category = params?.category;
  const search = params?.search;
  const showSold = params?.sold === "true";

  let query = supabase
    .from("listings")
    .select("*")
    .order("is_sold", { ascending: true })
    .order("created_at", { ascending: false });

  if (category) {
    query = query.eq("category", category);
  }
  if (!showSold) {
  query = query.eq("is_sold", false);
}

  if (search) {
    query = query.or(
      `title.ilike.%${search}%,description.ilike.%${search}%,city.ilike.%${search}%`
    );
  }

  const { data: listings, error } = await query;

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">Browse Listings</h1>

        <p className="text-xl text-gray-600 mb-8">
          Search local items, services, rentals, farm goods, pets, and businesses
          across Southeast Texas.
        </p>

        <form action="/browse" className="bg-white rounded-2xl shadow-md p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              name="search"
              defaultValue={search || ""}
              className="border rounded-xl px-4 py-3 md:col-span-3"
              placeholder="Search listings, city, or keyword..."
            />

            <button className="bg-red-600 text-white rounded-xl font-bold hover:bg-red-500">
              Search
            </button>
          </div>
        </form>

        <div className="flex flex-wrap gap-3 mb-8">
          <a
            href="/browse"
            className={`px-5 py-3 rounded-full font-semibold shadow ${
              !category ? "bg-blue-900 text-white" : "bg-white text-gray-900"
            }`}
          >
            All
          </a>

          <a
            href="/browse?category=Vehicles"
            className={`px-5 py-3 rounded-full font-semibold shadow ${
              category === "Vehicles"
                ? "bg-blue-900 text-white"
                : "bg-white text-gray-900"
            }`}
          >
            Vehicles
          </a>

          <a
            href="/browse?category=Rentals"
            className={`px-5 py-3 rounded-full font-semibold shadow ${
              category === "Rentals"
                ? "bg-blue-900 text-white"
                : "bg-white text-gray-900"
            }`}
          >
            Rentals
          </a>

          <a
            href="/browse?category=Services"
            className={`px-5 py-3 rounded-full font-semibold shadow ${
              category === "Services"
                ? "bg-blue-900 text-white"
                : "bg-white text-gray-900"
            }`}
          >
            Services
          </a>

          <a
            href="/browse?category=Farm%20%26%20Ranch"
            className={`px-5 py-3 rounded-full font-semibold shadow ${
              category === "Farm & Ranch"
                ? "bg-blue-900 text-white"
                : "bg-white text-gray-900"
            }`}
          >
            Farm & Ranch
          </a>

          <a
            href="/browse?category=Pets"
            className={`px-5 py-3 rounded-full font-semibold shadow ${
              category === "Pets"
                ? "bg-blue-900 text-white"
                : "bg-white text-gray-900"
            }`}
          >
            Pets
          </a>
          <a
  href="/browse?sold=true"
  className={`px-5 py-3 rounded-full font-semibold shadow ${
    showSold ? "bg-red-600 text-white" : "bg-white text-gray-900"
  }`}
>
  Show Sold
</a>
        </div>

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl mb-6">
            Could not load listings.
          </div>
        )}

        {!listings || listings.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">No listings yet</h2>
            <p className="text-gray-600 mb-5">
              Be the first to post on 409 Marketplace.
            </p>

            <a
              href="/post"
              className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold"
            >
              Post First Listing
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <a
  key={listing.id}
  href={`/listing/${listing.id}`}
  className="bg-white rounded-2xl shadow-md overflow-hidden hover:shadow-xl transition block"
>
  <div className="relative">

    {listing.image_url ? (
      <img
        src={listing.image_url}
        alt={listing.title}
        className="h-44 w-full object-cover"
      />
    ) : (
      <div className="h-44 bg-gray-300 flex items-center justify-center text-6xl">
        📦
      </div>
    )}

    {listing.is_sold && (
      <div className="absolute top-3 left-3 bg-red-600 text-white px-4 py-2 rounded-full font-bold shadow">
        SOLD
      </div>
    )}

  </div>
                <div className="p-5">
                  <p className="text-sm text-gray-500">{listing.city}</p>

                  <h2 className="text-xl font-bold">{listing.title}</h2>

                  <p className="text-2xl font-bold text-green-700 mt-2">
                    {listing.price}
                  </p>

                  <p className="text-sm text-gray-500 mt-2">
                    {listing.category}
                  </p>

                  <p className="mt-3 text-gray-600">{listing.description}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
