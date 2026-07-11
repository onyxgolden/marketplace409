export class PetVotingApplication {
  constructor({ supabase } = {}) {
    this.supabase = supabase;
  }

  async voteForPet({ petId, currentVotes = 0 }) {
    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      return {
        ok: false,
        message: "Please login to vote.",
        requiresAuthentication: true,
      };
    }

    const { error: voteError } = await this.supabase
      .from("pet_votes")
      .insert([
        {
          pet_id: petId,
          user_id: user.id,
        },
      ]);

    if (voteError) {
      return {
        ok: false,
        message: "You have already voted for this pet.",
        duplicateVote: true,
        error: voteError,
      };
    }

    const nextVotes = currentVotes + 1;

    const { error } = await this.supabase
      .from("pets")
      .update({
        votes: nextVotes,
      })
      .eq("id", petId);

    if (error) {
      return {
        ok: false,
        message: error.message || "Vote failed",
        error,
      };
    }

    return {
      ok: true,
      reload: true,
      votes: nextVotes,
    };
  }
}

Object.freeze(PetVotingApplication);
