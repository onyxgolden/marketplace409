"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import { createInvestorApplicationSuite } from "@/infrastructure/composition";

const {
  investorCashBuyerApplication: cashBuyerApplication,
} = createInvestorApplicationSuite();

export default function EditCashBuyerPage() {
  const params = useParams();
  const router = useRouter();
  const buyerId = params.id;

  const [form, setForm] = useState(() =>
    cashBuyerApplication.getInitialCashBuyerForm(),
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadBuyer() {
      const result = await cashBuyerApplication.loadCashBuyer(buyerId);

      if (!result.ok) {
        setError(result.message);
      } else {
        setForm(result.form);
      }

      setLoading(false);
    }

    if (buyerId) {
      loadBuyer();
    }
  }, [buyerId]);

  function updateField(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function saveBuyer(e) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const result = await cashBuyerApplication.updateCashBuyer({
      buyerId,
      form,
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.push(result.redirectTo);
  }

  async function deleteBuyer() {
    const confirmed = window.confirm(
      "Remove this cash buyer from the public directory?",
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    const result = await cashBuyerApplication.deleteCashBuyer(buyerId);

    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.push(result.redirectTo);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />
      <RealEstateWorkspaceNavigation />
        <section className="max-w-3xl mx-auto py-12 px-6">
          <p>Loading buyer...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="max-w-3xl mx-auto py-10 px-6">
        <a
          href="/investors/cash-buyers"
          className="inline-block mb-6 text-blue-700 font-bold hover:underline"
        >
          ← Back to Cash Buyers
        </a>

        <div className="bg-white rounded-3xl shadow p-8">
          <h1 className="text-4xl font-extrabold mb-2">Edit Cash Buyer</h1>

          <p className="text-gray-600 mb-8">
            Update or remove this cash buyer profile.
          </p>

          {error && (
            <div className="bg-red-100 text-red-800 p-4 rounded-xl mb-6">
              {error}
            </div>
          )}

          <form onSubmit={saveBuyer} className="space-y-5">
            <input
              name="name"
              value={form.name}
              onChange={updateField}
              required
              placeholder="Buyer name"
              className="w-full rounded-xl border p-3"
            />

            <input
              name="company_name"
              value={form.company_name}
              onChange={updateField}
              placeholder="Company name optional"
              className="w-full rounded-xl border p-3"
            />

            <input
              name="email"
              type="email"
              value={form.email}
              onChange={updateField}
              required
              placeholder="Email address"
              className="w-full rounded-xl border p-3"
            />

            <input
              name="phone"
              value={form.phone}
              onChange={updateField}
              required
              placeholder="Phone number"
              className="w-full rounded-xl border p-3"
            />

            <input
              name="cities"
              value={form.cities}
              onChange={updateField}
              placeholder="Cities / areas buying in"
              className="w-full rounded-xl border p-3"
            />

            <input
              name="property_types"
              value={form.property_types}
              onChange={updateField}
              placeholder="Property types"
              className="w-full rounded-xl border p-3"
            />

            <input
              name="max_price"
              value={form.max_price}
              onChange={updateField}
              placeholder="Max purchase price"
              className="w-full rounded-xl border p-3"
            />

            <input
              name="funding_type"
              value={form.funding_type}
              onChange={updateField}
              placeholder="Funding type"
              className="w-full rounded-xl border p-3"
            />

            <textarea
              name="notes"
              value={form.notes}
              onChange={updateField}
              placeholder="Notes"
              rows="5"
              className="w-full rounded-xl border p-3"
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="bg-green-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-600 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>

              <button
                type="button"
                onClick={deleteBuyer}
                disabled={saving}
                className="bg-red-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-600 disabled:opacity-50"
              >
                Remove From Directory
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
