"use client";

import { useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default function AddWholesalerPage() {
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [dealTypes, setDealTypes] = useState("");
  const [buyerTypes, setBuyerTypes] = useState("");
  const [notes, setNotes] = useState("");
  const [communityContact, setCommunityContact] = useState(false);

  async function handleSubmit() {
    const { error } = await supabase.from("investor_wholesalers").insert([
      {
        name,
        company_name: companyName,
        city,
        service_area: serviceArea,
        phone,
        email,
        website_url: websiteUrl,
        facebook_url: facebookUrl,
        deal_types: dealTypes,
        buyer_types: buyerTypes,
        notes,
        community_contact: communityContact,
      },
    ]);

    if (error) {
      alert("Error adding wholesaler contact: " + error.message);
console.log(error);
    }

    alert("Wholesaler contact added");
    window.location.href = "/investors/wholesalers";
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
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contact Name"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Company Name"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={serviceArea}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="Service Area / Counties"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="Website URL"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
              placeholder="Facebook URL"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={dealTypes}
              onChange={(e) => setDealTypes(e.target.value)}
              placeholder="Deal Types: wholesale, off-market, rentals, land, fixer uppers"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={buyerTypes}
              onChange={(e) => setBuyerTypes(e.target.value)}
              placeholder="Buyer Types: cash buyers, landlords, flippers, investors"
              className="w-full p-4 border rounded-xl"
            />

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className="w-full p-4 border rounded-xl h-32"
            />

            <label className="flex items-center gap-3 bg-gray-100 p-4 rounded-2xl">
              <input
                type="checkbox"
                checked={communityContact}
                onChange={(e) => setCommunityContact(e.target.checked)}
              />
              <span className="font-bold">Community Contact</span>
            </label>

            <button
              onClick={handleSubmit}
              className="w-full bg-red-600 text-white py-4 rounded-xl font-bold hover:bg-red-500"
            >
              Add Contact
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
