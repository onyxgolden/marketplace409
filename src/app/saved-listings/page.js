"use client";

import { SavedListingsApplication } from "@/application";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

const savedListingsApplication = new SavedListingsApplication({
  supabase,
});

export default function SavedListingsPage() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSavedListings() {
      const result =
        await savedListingsApplication.loadSavedListings();

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

      setFavorites(result.favorites);
      setLoading(false);
    }

    loadSavedListings();
  }, []);

  async function handleRemoveFavorite(favoriteId) {
    const result =
      await savedListingsApplication.removeSavedListing({
        favoriteId,
      });

    if (!result.ok) {
      if (result.requiresAuthentication) {
        alert(result.message);
        window.location.href = result.redirectTo;
        return;
      }

      console.log(result.error);
      alert(result.message);
      return;
    }

    setFavorites((currentFavorites) =>
      currentFavorites.filter(
        (favorite) => favorite.id !== result.favoriteId,
      ),
    );

    alert(result.message);
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">
          Saved Listings
        </h1>

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
                <div
                  key={favorite.id}
                  className="bg-white rounded-2xl shadow-md overflow-hidden hover:shadow-xl transition"
                >
                  <a
                    href={`/listing/${listing.id}`}
                    className="block"
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

                  <div className="px-5 pb-5">
                    <button
                      type="button"
                      onClick={() =>
                        handleRemoveFavorite(favorite.id)
                      }
                      className="w-full bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-gray-700"
                    >
                      Remove Saved Listing
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
