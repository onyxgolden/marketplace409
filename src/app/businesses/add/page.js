"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BusinessService } from "@/domains/business/business.service";

export default function AddBusinessPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    name: "",
    address: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function updateField(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await BusinessService.createBusiness({
        name: form.name,
        address: form.address,
      });

      router.push("/businesses");
    } catch (err) {
      setError(err?.message || "Failed to create business");
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
            onChange={(e) => updateField("name", e.target.value)}
            required
            style={{ display: "block", width: "100%" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Address</label>
          <input
            value={form.address}
            onChange={(e) => updateField("address", e.target.value)}
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