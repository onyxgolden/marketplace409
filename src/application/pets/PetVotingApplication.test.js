import { describe, expect, it, vi } from "vitest";

import { PetVotingApplication } from "./PetVotingApplication";

function createSupabaseMock({
  user = { id: "user-1" },
  voteError = null,
  updateError = null,
} = {}) {
  const getUser = vi.fn(async () => ({
    data: {
      user,
    },
  }));

  const insertVote = vi.fn(async () => ({
    error: voteError,
  }));

  const updateEq = vi.fn(async () => ({
    error: updateError,
  }));

  const updatePet = vi.fn(() => ({
    eq: updateEq,
  }));

  const from = vi.fn((table) => {
    if (table === "pet_votes") {
      return {
        insert: insertVote,
      };
    }

    if (table === "pets") {
      return {
        update: updatePet,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    auth: {
      getUser,
    },
    from,
    mocks: {
      getUser,
      from,
      insertVote,
      updatePet,
      updateEq,
    },
  };
}

describe("PetVotingApplication", () => {
  it("requires authentication before voting", async () => {
    const supabase = createSupabaseMock({
      user: null,
    });

    const application = new PetVotingApplication({
      supabase,
    });

    const result = await application.voteForPet({
      petId: "pet-1",
      currentVotes: 4,
    });

    expect(supabase.mocks.from).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      message: "Please login to vote.",
      requiresAuthentication: true,
    });
  });

  it("records a vote and updates the pet vote total", async () => {
    const supabase = createSupabaseMock();

    const application = new PetVotingApplication({
      supabase,
    });

    const result = await application.voteForPet({
      petId: "pet-1",
      currentVotes: 4,
    });

    expect(supabase.mocks.getUser).toHaveBeenCalledOnce();

    expect(supabase.mocks.insertVote).toHaveBeenCalledWith([
      {
        pet_id: "pet-1",
        user_id: "user-1",
      },
    ]);

    expect(supabase.mocks.updatePet).toHaveBeenCalledWith({
      votes: 5,
    });

    expect(supabase.mocks.updateEq).toHaveBeenCalledWith(
      "id",
      "pet-1",
    );

    expect(result).toEqual({
      ok: true,
      reload: true,
      votes: 5,
    });
  });

  it("uses zero as the default current vote total", async () => {
    const supabase = createSupabaseMock();

    const application = new PetVotingApplication({
      supabase,
    });

    const result = await application.voteForPet({
      petId: "pet-1",
    });

    expect(supabase.mocks.updatePet).toHaveBeenCalledWith({
      votes: 1,
    });

    expect(result).toEqual({
      ok: true,
      reload: true,
      votes: 1,
    });
  });

  it("normalizes duplicate vote failures", async () => {
    const voteError = {
      message: "Duplicate vote",
    };

    const supabase = createSupabaseMock({
      voteError,
    });

    const application = new PetVotingApplication({
      supabase,
    });

    const result = await application.voteForPet({
      petId: "pet-1",
      currentVotes: 4,
    });

    expect(supabase.mocks.updatePet).not.toHaveBeenCalled();

    expect(result).toEqual({
      ok: false,
      message: "You have already voted for this pet.",
      duplicateVote: true,
      error: voteError,
    });
  });

  it("normalizes pet vote update failures", async () => {
    const updateError = {
      message: "Vote update failed",
    };

    const supabase = createSupabaseMock({
      updateError,
    });

    const application = new PetVotingApplication({
      supabase,
    });

    const result = await application.voteForPet({
      petId: "pet-1",
      currentVotes: 4,
    });

    expect(result).toEqual({
      ok: false,
      message: "Vote update failed",
      error: updateError,
    });
  });

  it("provides a fallback pet vote update error message", async () => {
    const updateError = {};

    const supabase = createSupabaseMock({
      updateError,
    });

    const application = new PetVotingApplication({
      supabase,
    });

    const result = await application.voteForPet({
      petId: "pet-1",
      currentVotes: 4,
    });

    expect(result).toEqual({
      ok: false,
      message: "Vote failed",
      error: updateError,
    });
  });
});
