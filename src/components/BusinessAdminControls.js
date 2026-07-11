"use client";

import { useEffect, useState } from "react";

import { AdminAuthorizationApplication } from "@/application/business";
import DeleteBusinessButton from "@/components/DeleteBusinessButton";
import { supabase } from "@/lib/supabase";

const adminAuthorizationApplication = new AdminAuthorizationApplication({
  supabase,
});

export default function BusinessAdminControls({ businessId }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadAdminAuthorization() {
      const result =
        await adminAuthorizationApplication.loadAdminAuthorization();

      if (active && result.ok) {
        setIsAdmin(result.isAdmin);
      }
    }

    loadAdminAuthorization();

    return () => {
      active = false;
    };
  }, []);

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
