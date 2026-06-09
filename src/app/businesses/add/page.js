"use client";

import { useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default function AddBusinessPage() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState(null);

  async function handleSubmit() {
    let imageUrl = "";

    if (image) {
      const fileExt = image.name.split(".").pop();
      const fileName = `${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("listing-images")
        .upload(fileName, image, {
          contentType: image.type,
          upsert: false,
        });

      if (uploadError) {
        alert("Error uploading image");
        return;
      }

      const { data } = supabase.storage
        .from("listing-images")
        .getPublicUrl(fileName);

      imageUrl = data.publicUrl;
    }

    const { error } = await supabase.from("businesses").insert([
      {
        name,
        category,
        city,
        phone,
        website_url: websiteUrl,
        facebook_url: facebookUrl,
        description,
        image_url: imageUrl,
      },
    ]);

    if (error) {
      alert("Error adding business");
      console.log(error);
    } else {
      alert("Business added successfully");
      window.location.href = "/businesses";
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-3xl mx-auto py-12 px-6">
        <div className="bg-white rounded-3xl shadow-md p-8">
          <h1 className="text-4xl font-extrabold mb-8">Add Local Business</h1>

          <div className="space-y-6">
            <input
              type="text"
              placeholder="Business Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Select Category</option>

              <option value="Pawn Shops">Pawn Shops</option>
              <option value="Trailer Dealers">Trailer Dealers</option>
              <option value="Lawn Equipment">Lawn Equipment</option>
              <option value="Farm & Ranch">Farm & Ranch</option>
              <option value="Contractors">Contractors</option>
              <option value="Restaurants">Restaurants</option>
              <option value="Local Services">Local Services</option>
              <option value="Automotive">Automotive</option>
              <option value="Real Estate">Real Estate</option>
              <option value="Flea Market Vendors">Flea Market Vendors</option>
              <option value="Small Businesses">Small Businesses</option>
              <option value="Health & Fitness">Health & Fitness</option>
              <option value="Beauty & Salon">Beauty & Salon</option>
              <option value="Retail">Retail</option>
              <option value="Electronics">Electronics</option>
              <option value="Home Services">Home Services</option>
              <option value="Professional Services">
                Professional Services
              </option>
              <option value="Pets & Livestock">Pets & Livestock</option>
              <option value="Entertainment">Entertainment</option>
              <option value="Community Organizations">
                Community Organizations
              </option>
            </select>

            <input
              type="text"
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Website URL"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Facebook URL"
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <textarea
              placeholder="Business Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files[0])}
            />

            <button
              onClick={handleSubmit}
              className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500"
            >
              Add Business
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
