"use client";

import { supabase } from "@/lib/supabase";

export default function DeleteJobButton({ jobId }) {
  async function handleDelete() {
    const confirmed = window.confirm(
      "Are you sure you want to delete this job?",
    );

    if (!confirmed) return;

    const { error } = await supabase.from("jobs").delete().eq("id", jobId);

    if (error) {
      alert("Error deleting job");
      console.log(error);
      return;
    }

    alert("Job deleted");
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
