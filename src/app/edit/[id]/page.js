"use client";

import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { uploadImage } from "@/lib/uploadImage";
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
  const [imageUrl, setImageUrl] = useState("");
  const [newImageFile, setNewImageFile] = useState(null);

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
    setImageUrl(data.image_url || "");
    setLoading(false);
  }

  async function handleSave() {
    setIsSaving(true);

    const finalImageUrl = await uploadImage({
      file: newImageFile,
      currentImageUrl: imageUrl,
      folder: "listings",
      prefix: "listing",
      recordId: listingId,
    });

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
        image_url: finalImageUrl,
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
            {imageUrl && (
              <div>
                <label className="block font-bold mb-3">Current Image</label>
                <img
                  src={imageUrl}
                  alt={title}
                  className="w-full max-h-80 object-cover rounded-2xl border"
                />
              </div>
            )}

            <div>
              <label className="block font-bold mb-3">Replace Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setNewImageFile(e.target.files[0])}
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
              <p className="text-sm text-gray-500 mt-2">
                Leave this blank to keep the current image.
              </p>
            </div>

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
