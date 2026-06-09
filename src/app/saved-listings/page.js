"use client";

import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

export default function SavedListingsPage() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSavedListings();
  }, []);

  async function loadSavedListings() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/auth";
      return;
    }

    const { data, error } = await supabase
      .from("favorites")
      .select("id, listings(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.log(error);
      alert("Could not load saved listings.");
    } else {
      setFavorites(data || []);
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">Saved Listings</h1>

        <p className="text-xl text-gray-600 mb-8">
          Listings you saved for later.
        </p>

        {loading ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            Loading saved listings...
          </div>
        ) : favorites.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            No saved listings yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {favorites.map((favorite) => {
              const listing = favorite.listings;

              return (
                <a
                  key={favorite.id}
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
                    <p className="text-sm text-gray-500">{listing.city}</p>
                    <h2 className="text-xl font-bold">{listing.title}</h2>
                    <p className="text-2xl font-bold text-green-700 mt-2">
                      {listing.price}
                    </p>
                    <p className="text-sm text-gray-500 mt-2">
                      {listing.category}
                    </p>
                  </div>
                </a>
              );
            })}
            <button
              onClick={(e) => {
                e.preventDefault();
                removeFavorite(favorite.id);
              }}
              className="mt-4 w-full bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-gray-700"
            >
              Remove Saved Listing
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
