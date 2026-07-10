"use client";

import { useState } from "react";
import Header from "@/components/Header";
import { InvestorWholesalerApplication } from "@/application/investors";
import { supabase } from "@/lib/supabase";

const application = new InvestorWholesalerApplication({ supabase });

export default function AddWholesalerPage() {
  const [form, setForm] = useState(application.getInitialWholesalerForm());

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleSubmit() {
    const result = await application.createWholesaler(form);

    if (!result.ok) {
      alert("Error adding wholesaler contact: " + result.message);
      console.log(result.error);
      return;
    }

    alert(result.message);
    window.location.href = result.redirectTo;
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-3xl mx-auto py-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <h1 className="text-4xl font-extrabold mb-8">
            Add Wholesaler Contact
          </h1>

          <div className="space-y-4">
            <input value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Contact Name" className="w-full p-4 border rounded-xl" />
            <input value={form.companyName} onChange={(e) => updateField("companyName", e.target.value)} placeholder="Company Name" className="w-full p-4 border rounded-xl" />
            <input value={form.contactType} onChange={(e) => updateField("contactType", e.target.value)} placeholder="Contact Type: Cash Buyer, Wholesaler, Bird Dog, Land Buyer" className="w-full p-4 border rounded-xl" />
            <input value={form.countiesServed} onChange={(e) => updateField("countiesServed", e.target.value)} placeholder="Counties Served: Orange, Jefferson, Hardin" className="w-full p-4 border rounded-xl" />
            <input value={form.city} onChange={(e) => updateField("city", e.target.value)} placeholder="City" className="w-full p-4 border rounded-xl" />
            <input value={form.serviceArea} onChange={(e) => updateField("serviceArea", e.target.value)} placeholder="Service Area / Counties" className="w-full p-4 border rounded-xl" />
            <input value={form.phone} onChange={(e) => updateField("phone", e.target.value)} placeholder="Phone" className="w-full p-4 border rounded-xl" />
            <input value={form.email} onChange={(e) => updateField("email", e.target.value)} placeholder="Email" className="w-full p-4 border rounded-xl" />
            <input value={form.websiteUrl} onChange={(e) => updateField("websiteUrl", e.target.value)} placeholder="Website URL" className="w-full p-4 border rounded-xl" />
            <input value={form.facebookUrl} onChange={(e) => updateField("facebookUrl", e.target.value)} placeholder="Facebook URL" className="w-full p-4 border rounded-xl" />
            <input value={form.dealTypes} onChange={(e) => updateField("dealTypes", e.target.value)} placeholder="Deal Types: wholesale, off-market, rentals, land, fixer uppers" className="w-full p-4 border rounded-xl" />
            <input value={form.buyerTypes} onChange={(e) => updateField("buyerTypes", e.target.value)} placeholder="Buyer Types: cash buyers, landlords, flippers, investors" className="w-full p-4 border rounded-xl" />

            <textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)} placeholder="Notes" className="w-full p-4 border rounded-xl h-32" />

            <label className="flex items-center gap-3 bg-gray-100 p-4 rounded-2xl">
              <input type="checkbox" checked={form.communityContact} onChange={(e) => updateField("communityContact", e.target.checked)} />
              <span className="font-bold">Community Contact</span>
            </label>

            <button onClick={handleSubmit} className="w-full bg-red-600 text-white py-4 rounded-xl font-bold hover:bg-red-500">
              Add Contact
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
