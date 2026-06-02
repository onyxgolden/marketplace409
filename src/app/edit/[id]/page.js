"use client";

import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

export default function EditListingPage({ params }) {
  const [listingId, setListingId] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      setListingId(resolvedParams.id);
      loadListing(resolvedParams.id);
    }

    start();
  }, [params]);

  async function loadListing(id) {
    const { data, error } = await supabase
      .from("listings")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      alert("Listing not found.");
      window.location.href = "/my-listings";
      return;
    }

    setTitle(data.title || "");
    setDescription(data.description || "");
    setPrice(data.price || "");
    setCategory(data.category || "");
    setCity(data.city || "");
    setSellerName(data.seller_name || "");
    setSellerEmail(data.seller_email || "");
    setSellerPhone(data.seller_phone || "");
    setLoading(false);
  }

  async function handleSave() {
    setIsSaving(true);

    const { error } = await supabase
      .from("listings")
      .update({
        title,
        description,
        price,
        category,
        city,
        seller_name: sellerName,
        seller_email: sellerEmail,
        seller_phone: sellerPhone,
      })
      .eq("id", listingId);

    if (error) {
      alert("Error saving listing.");
      console.log(error);
      setIsSaving(false);
      return;
    }

    alert("Listing updated.");
    window.location.href = `/listing/${listingId}`;
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 text-gray-900">
        <Header />
        <section className="max-w-3xl mx-auto py-12 px-6">
          <div className="bg-white rounded-3xl shadow-md p-8 text-center">
            Loading listing...
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-3xl mx-auto py-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <h1 className="text-4xl font-extrabold mb-8">Edit Listing</h1>

          <div className="space-y-6">
            <input
              type="text"
              placeholder="Listing Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <textarea
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <input
              type="text"
              placeholder="Price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Seller Name"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="email"
              placeholder="Seller Email"
              value={sellerEmail}
              onChange={(e) => setSellerEmail(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Seller Phone"
              value={sellerPhone}
              onChange={(e) => setSellerPhone(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold hover:bg-blue-800 disabled:bg-gray-400"
            >
              {isSaving ? "Saving..." : "Save Listing Changes"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}