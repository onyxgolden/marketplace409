"use client";

import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";

const {
  listingApplication,
} = createMarketplaceApplicationSuite();

export default function DeleteListingButton({ listingId, ownerId }) {
  async function handleDelete() {
    const confirmed = window.confirm(
      "Are you sure you want to delete this listing?",
    );

    if (!confirmed) return;

    const result = await listingApplication.deleteListing({
      listingId,
      ownerId,
      confirmed,
    });

    if (!result.ok) {
      if (result.message) {
        alert(result.message);
      }

      if (result.error) {
        console.log(result.error);
      }

      if (result.redirectTo) {
        window.location.href = result.redirectTo;
      }

      return;
    }

    alert(result.message);
    window.location.href = result.redirectTo;
  }

  return (
    <button
      onClick={handleDelete}
      className="w-full bg-gray-300 text-gray-900 py-4 rounded-2xl text-xl font-bold hover:bg-gray-400 mt-4"
    >
      Delete Listing
    </button>
  );
}
