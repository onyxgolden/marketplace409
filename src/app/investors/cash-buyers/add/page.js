"use client";

import { useState } from "react";
import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import { createInvestorApplicationSuite } from "@/infrastructure/composition";

const {
  investorCashBuyerApplication: cashBuyerApplication,
} = createInvestorApplicationSuite();

export default function AddCashBuyerPage() {
  const [form, setForm] = useState(() =>
    cashBuyerApplication.getInitialCashBuyerForm(),
  );

  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  function updateField(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const result = await cashBuyerApplication.createCashBuyer(form);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setSubmitted(result.submitted);
  }

  if (submitted) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />
      <RealEstateWorkspaceNavigation />

        <section className="max-w-3xl mx-auto py-12 px-6">
          <div className="bg-white rounded-3xl shadow p-8 text-center">
            <h1 className="text-3xl font-extrabold mb-4">Cash Buyer Added</h1>

            <p className="text-gray-600 mb-6">
              Your buyer profile has been added to the 409 Cash Buyer Directory.
            </p>

            <a
              href="/investors/cash-buyers"
              className="inline-block bg-green-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-600"
            >
              View Cash Buyer Directory
            </a>
          </div>
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
          <h1 className="text-4xl font-extrabold mb-2">Add Cash Buyer</h1>

          <p className="text-gray-600 mb-8">
            Add a buyer looking for investment properties in the 409 area.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
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
              placeholder="Cities / areas buying in: Orange, Vidor, Beaumont, etc."
              className="w-full rounded-xl border p-3"
            />

            <input
              name="property_types"
              value={form.property_types}
              onChange={updateField}
              placeholder="Property types: single family, duplex, land, rentals, etc."
              className="w-full rounded-xl border p-3"
            />

            <input
              name="max_price"
              value={form.max_price}
              onChange={updateField}
              placeholder="Max purchase price: $150k, $250k, no limit, etc."
              className="w-full rounded-xl border p-3"
            />

            <input
              name="funding_type"
              value={form.funding_type}
              onChange={updateField}
              placeholder="Funding type: cash, hard money, private money, conventional"
              className="w-full rounded-xl border p-3"
            />

            <textarea
              name="notes"
              value={form.notes}
              onChange={updateField}
              placeholder="Notes: preferred deals, rehab level, closing speed, etc."
              rows="5"
              className="w-full rounded-xl border p-3"
            />

            {error && (
              <div className="bg-red-100 text-red-800 p-4 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="bg-green-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-600"
            >
              Add Cash Buyer
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
