"use client";

import { FavoriteApplication } from "@/application";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

const favoriteApplication = new FavoriteApplication({
  supabase,
});

export default function FavoriteButton({ listingId }) {
  const [isSaved, setIsSaved] = useState(false);
  const [favoriteId, setFavoriteId] = useState(null);

  useEffect(() => {
    async function loadFavoriteStatus() {
      const result = await favoriteApplication.loadFavoriteStatus({
        listingId,
      });

      if (!result.ok) {
        console.log(result.error);
        return;
      }

      setIsSaved(result.isSaved);
      setFavoriteId(result.favoriteId);
    }

    loadFavoriteStatus();
  }, [listingId]);

  async function handleFavorite() {
    const result = await favoriteApplication.toggleFavorite({
      listingId,
      isSaved,
      favoriteId,
    });

    if (!result.ok) {
      if (result.requiresAuthentication) {
        alert(result.message);
        window.location.href = result.redirectTo;
        return;
      }

      alert(
        isSaved
          ? "Could not remove saved listing."
          : "Could not save listing.",
      );
      console.log(result.error);
      return;
    }

    setIsSaved(result.isSaved);
    setFavoriteId(result.favoriteId);
  }

  return (
    <button
      onClick={handleFavorite}
      className={`w-full py-4 rounded-2xl text-xl font-bold mb-4 ${
        isSaved
          ? "bg-pink-600 text-white hover:bg-pink-500"
          : "bg-purple-700 text-white hover:bg-purple-600"
      }`}
    >
      {isSaved ? "❤️ Saved" : "🤍 Save Listing"}
    </button>
  );
}
