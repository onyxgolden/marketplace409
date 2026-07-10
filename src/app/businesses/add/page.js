"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BusinessCreateApplication } from "@/application";
import { supabase } from "@/lib/supabase";

const businessCreateApplication = new BusinessCreateApplication({
  supabase,
});

export default function AddBusinessPage() {
  const router = useRouter();

  const [form, setForm] = useState(() =>
    businessCreateApplication.getInitialBusinessCreateForm(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await businessCreateApplication.createBusiness(form);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(result.redirectTo);
    } catch (creationError) {
      setError(creationError?.message || "Failed to create business");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Add Business</h1>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label>Name</label>
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            required
            style={{ display: "block", width: "100%" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Address</label>
          <input
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            required
            style={{ display: "block", width: "100%" }}
          />
        </div>

        {error && (
          <div style={{ color: "red", marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Business"}
        </button>
      </form>
    </div>
  );
}
