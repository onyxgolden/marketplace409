"use client";

import { supabase } from "@/lib/supabase";

export default function VotePetButton({ petId, currentVotes = 0 }) {
  async function handleVote() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please login to vote.");
      return;
    }

    const { error: voteError } = await supabase.from("pet_votes").insert([
      {
        pet_id: petId,
        user_id: user.id,
      },
    ]);

    if (voteError) {
      alert("You have already voted for this pet.");
      return;
    }

    const { error } = await supabase
      .from("pets")
      .update({
        votes: currentVotes + 1,
      })
      .eq("id", petId);

    if (error) {
      alert("Vote failed");
      return;
    }

    window.location.reload();
  }

  return (
    <button
      onClick={handleVote}
      className="w-full mt-3 bg-pink-600 text-white py-3 rounded-xl font-bold hover:bg-pink-500"
    >
      ❤️ Vote for this Pet
    </button>
  );
}
