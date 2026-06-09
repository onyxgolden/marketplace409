"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DeleteBusinessButton from "@/components/DeleteBusinessButton";

export default function BusinessAdminControls({ businessId }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdmin();
  }, []);

  async function checkAdmin() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.email === "jasonmorgan99@gmail.com") {
      setIsAdmin(true);
    }
  }

  if (!isAdmin) return null;

  return (
    <>
      <a
        href={`/businesses/edit/${businessId}`}
        className="block mt-3 bg-yellow-500 text-gray-900 text-center py-3 rounded-xl font-bold hover:bg-yellow-400"
      >
        Edit Business
      </a>

      <DeleteBusinessButton businessId={businessId} />
    </>
  );
}
