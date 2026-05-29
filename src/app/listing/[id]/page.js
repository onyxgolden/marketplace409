export const dynamic = "force-dynamic";

import FavoriteButton from "@/components/FavoriteButton";
import MarkSoldButton from "@/components/MarkSoldButton";
import DeleteListingButton from "@/components/DeleteListingButton";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default async function ListingDetailPage({ params }) {
  const { id } = await params;

  const { data: listing, error } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !listing) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />

        <section className="max-w-4xl mx-auto py-12 px-6">
          <div className="bg-white rounded-3xl shadow-md p-8 text-center">
            <h1 className="text-3xl font-bold mb-4">Listing Not Found</h1>

            <a
              href="/browse"
              className="bg-blue-900 text-white px-6 py-3 rounded-xl font-bold"
            >
              Back to Browse
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <a href="/browse" className="text-blue-900 font-bold">
          ← Back to Listings
        </a>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
          <div className="bg-white rounded-3xl shadow-md overflow-hidden">
            {listing.image_url ? (
              <img
                src={listing.image_url}
                alt={listing.title}
                className="w-full h-[450px] object-cover"
              />
            ) : (
              <div className="h-[450px] bg-gray-300 flex items-center justify-center text-7xl">
                📦
              </div>
            )}
          </div>

          <div className="bg-white rounded-3xl shadow-md p-8">
            <p className="text-sm text-gray-500 mb-2">{listing.city}</p>

            <h1 className="text-4xl font-extrabold mb-4">
              {listing.title}
            </h1>

            <p className="text-4xl font-extrabold text-green-700 mb-4">
              {listing.price}
            </p>

            <p className="text-sm text-gray-500 mb-6">
              {listing.category}
            </p>

            <p className="text-lg text-gray-700 mb-8">
              {listing.description}
            </p>

            <div className="bg-gray-100 rounded-2xl p-5 mb-8">
              <h3 className="text-2xl font-bold mb-4">Seller Information</h3>

              <div className="space-y-2 text-lg">
                <p>
                  <span className="font-bold">Name:</span>{" "}
                  {listing.seller_name || "Not provided"}
                </p>

                <p>
                  <span className="font-bold">Email:</span>{" "}
                  {listing.seller_email || "Not provided"}
                </p>

                <p>
                  <span className="font-bold">Phone:</span>{" "}
                  {listing.seller_phone || "Not provided"}
                </p>
              </div>
            </div>

            <div className="bg-gray-100 rounded-2xl p-5 mb-4">
              <h3 className="text-xl font-bold mb-3">Contact Seller</h3>

              <p className="text-gray-600 mb-4">
                Messaging is coming soon. For now, use the seller contact details above.
              </p>

              <button className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500">
                Request Seller Contact
              </button>
            </div>
            <FavoriteButton listingId={listing.id} />
            <a
              href="/browse"
              className="block text-center w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold hover:bg-blue-800 mb-4"
            >
              Back to Browse
            </a>

<MarkSoldButton
  listingId={listing.id}
  ownerId={listing.user_id}
  isSold={listing.is_sold}
/>

            <a
              href={`/edit/${listing.id}`}
              className="block text-center w-full bg-yellow-500 text-gray-900 py-4 rounded-2xl text-xl font-bold hover:bg-yellow-400 mb-4"
            >
              Edit Listing
            </a>

            <button className="w-full bg-gray-800 text-white py-4 rounded-2xl text-xl font-bold hover:bg-gray-700">
              Share Listing
            </button>

            <DeleteListingButton listingId={listing.id} ownerId={listing.user_id} />
          </div>
        </div>
      </section>
    </main>
  );
}