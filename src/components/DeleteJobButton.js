"use client";

import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";

const {
  jobApplication,
} = createMarketplaceApplicationSuite();

export default function DeleteJobButton({ jobId }) {
  async function handleDelete() {
    const confirmed = window.confirm(
      "Are you sure you want to delete this job?",
    );

    if (!confirmed) return;

    const result = await jobApplication.deleteJob(jobId);

    if (!result.ok) {
      alert(result.message);
      console.log(result.error);
      return;
    }

    alert(result.message);
    window.location.reload();
  }

  return (
    <button
      onClick={handleDelete}
      className="block w-full mt-3 bg-red-600 text-white text-center py-3 rounded-xl font-bold hover:bg-red-500"
    >
      Delete Job
    </button>
  );
}
