"use client";

import {
  createBusinessApplicationSuite,
} from "@/infrastructure/composition";

const {
  businessDeleteApplication,
} = createBusinessApplicationSuite();

export default function DeleteBusinessButton({ businessId }) {
  async function handleDelete() {
    const confirmed = confirm("Are you sure you want to delete this business?");

    if (!confirmed) return;

    const result = await businessDeleteApplication.deleteBusiness({
      businessId,
    });

    if (!result.ok) {
      alert(result.message);
      console.log(result.error);
      return;
    }

    alert(result.message);

    if (result.reload) {
      window.location.reload();
    }
  }

  return (
    <button
      onClick={handleDelete}
      className="w-full mt-3 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-500"
    >
      Delete Business
    </button>
  );
}
