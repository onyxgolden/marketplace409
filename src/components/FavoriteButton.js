"use client";

import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

export default function FavoriteButton({ listingId }) {
  const [isSaved, setIsSaved] = useState(false);
  const [favoriteId, setFavoriteId] = useState(null);

  useEffect(() => {
    checkSavedStatus();
  }, []);

  async function checkSavedStatus() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    const { data } = await supabase
      .from("favorites")
      .select("id")
      .eq("user_id", user.id)
      .eq("listing_id", listingId)
      .maybeSingle();

    if (data) {
      setIsSaved(true);
      setFavoriteId(data.id);
    }
  }

  async function handleFavorite() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please sign in to save listings.");
      window.location.href = "/auth";
      return;
    }

    if (isSaved) {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("id", favoriteId);

      if (error) {
        alert("Could not remove saved listing.");
        console.log(error);
      } else {
        setIsSaved(false);
        setFavoriteId(null);
      }

      return;
    }

    const { data, error } = await supabase
      .from("favorites")
      .insert([
        {
          user_id: user.id,
          listing_id: listingId,
        },
      ])
      .select()
      .single();

    if (error) {
      alert("Could not save listing.");
      console.log(error);
    } else {
      setIsSaved(true);
      setFavoriteId(data.id);
    }
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
