"use client";

import Header from "@/components/Header";
import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";
import { useEffect, useState } from "react";

const {
  myListingsApplication,
} = createMarketplaceApplicationSuite();

export default function MyListingsPage() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMyListings() {
      const result = await myListingsApplication.loadMyListings();

      if (!result.ok) {
        if (result.requiresAuthentication) {
          window.location.href = result.redirectTo;
          return;
        }

        console.log(result.error);
        alert(result.message);
        setLoading(false);
        return;
      }

      setListings(result.listings);
      setLoading(false);
    }

    loadMyListings();
  }, []);

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">
          My Listings
        </h1>

        <p className="text-xl text-gray-600 mb-8">
          Manage the listings you posted on 409 Marketplace.
        </p>

        {loading ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            Loading your listings...
          </div>
        ) : listings.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">
              No listings yet
            </h2>

            <a
              href="/post"
              className="inline-block mt-4 bg-red-600 text-white px-6 py-3 rounded-xl font-bold"
            >
              Post Your First Listing
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

                <div className="p-5">
                  <p className="text-sm text-gray-500">
                    {listing.city}
                  </p>

                  <h2 className="text-xl font-bold">
                    {listing.title}
                  </h2>

                  <p className="text-2xl font-bold text-green-700 mt-2">
                    {listing.price}
                  </p>

                  <p className="text-sm text-gray-500 mt-2">
                    {listing.category}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
