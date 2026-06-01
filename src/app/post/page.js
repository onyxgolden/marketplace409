"use client";

import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useState } from "react";

export default function PostPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [sellerPhone, setSellerPhone] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  async function handleSubmit() {
setIsPosting(true);

const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) {
  alert("You can browse listings as a guest, but you need a free account to post.");
  setIsPosting(false);
  window.location.href = "/auth";
  return;
}

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
  console.log(uploadError);
  setIsPosting(false);
  return;
}

      const { data } = supabase.storage
        .from("listing-images")
        .getPublicUrl(fileName);

      imageUrl = data.publicUrl;
    }

    const { data: newListing, error } = await supabase
      .from("listings")
      .insert([
        {
          title,
          description,
          price,
          category,
          city,
          image_url: imageUrl,
          seller_name: sellerName,
          seller_email: sellerEmail,
          seller_phone: sellerPhone,
          user_id: user.id,
        },
      ])
      .select()
      .single();

    if (error) {
  alert("Error posting listing");
  console.log(error);
  setIsPosting(false);
}
    
      else {
      alert("Listing posted successfully!");
      window.location.href = `/listing/${newListing.id}`;
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-4xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">Post a Listing</h1>

        <p className="text-xl text-gray-600 mb-10">
          Sell locally across Southeast Texas.
        </p>

        <div className="bg-white rounded-3xl shadow-xl p-8">
          <div className="grid grid-cols-1 gap-6">
            <input
              className="border rounded-xl px-4 py-4"
              placeholder="Listing Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <textarea
              className="border rounded-xl px-4 py-4 h-40"
              placeholder="Describe your item or service..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <input
                className="border rounded-xl px-4 py-4"
                placeholder="Price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />

              <select
                className="border rounded-xl px-4 py-4"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Select Category</option>
                <option>Vehicles</option>
                <option>Rentals</option>
                <option>Services</option>
                <option>Farm & Ranch</option>
                <option>Pets</option>
              </select>
            </div>

            <input
              className="border rounded-xl px-4 py-4"
              placeholder="City or ZIP"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <input
                className="border rounded-xl px-4 py-4"
                placeholder="Seller Name"
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
              />

              <input
                className="border rounded-xl px-4 py-4"
                placeholder="Seller Email"
                value={sellerEmail}
                onChange={(e) => setSellerEmail(e.target.value)}
              />
            </div>

            <input
              className="border rounded-xl px-4 py-4"
              placeholder="Seller Phone"
              value={sellerPhone}
              onChange={(e) => setSellerPhone(e.target.value)}
            />

            <div className="border-2 border-dashed rounded-2xl p-10 text-center bg-gray-50">
              <p className="text-lg font-semibold mb-3">📸 Upload Photo</p>

              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files[0];

                  if (file) {
                    setImage(file);
                    setImagePreview(URL.createObjectURL(file));
                  }
                }}
              />

              {imagePreview && (
                <div className="mt-6">
                  <p className="font-bold mb-3">Image Preview</p>

                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full max-h-80 object-cover rounded-2xl shadow"
                  />
                </div>
              )}
            </div>

            <button
  onClick={handleSubmit}
  disabled={isPosting}
  className="bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500 disabled:bg-gray-400"
>
  {isPosting ? "Posting..." : "Post Listing"}
</button>
          </div>
        </div>
      </section>
    </main>
  );
}