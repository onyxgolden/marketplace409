"use client";

import { ListingApplication } from "@/application";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { uploadImage } from "@/lib/uploadImage";
import { useEffect, useState } from "react";

const listingApplication = new ListingApplication({
  supabase,
  imageUploader: uploadImage,
});

export default function EditListingPage({ params }) {
  const [listingId, setListingId] = useState("");
  const [form, setForm] = useState(() =>
    listingApplication.getInitialListingForm(),
  );
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newImageFile, setNewImageFile] = useState(null);

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      const resolvedListingId = resolvedParams.id;

      setListingId(resolvedListingId);

      const result =
        await listingApplication.loadListing(resolvedListingId);

      if (!result.ok) {
        alert(result.message);

        if (result.error) {
          console.log(result.error);
        }

        if (result.redirectTo) {
          window.location.href = result.redirectTo;
        }

        return;
      }

      setForm(result.form);
      setLoading(false);
    }

    start();
  }, [params]);

  function updateForm(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleSave() {
    setIsSaving(true);

    const result = await listingApplication.updateListing({
      listingId,
      form,
      newImageFile,
    });

    if (!result.ok) {
      alert(result.message);

      if (result.error) {
        console.log(result.error);
      }

      setIsSaving(false);
      return;
    }

    alert(result.message);
    window.location.href = result.redirectTo;
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
          <h1 className="text-4xl font-extrabold mb-8">
            Edit Listing
          </h1>

          <div className="space-y-6">
            {form.imageUrl && (
              <div>
                <label className="block font-bold mb-3">
                  Current Image
                </label>
                <img
                  src={form.imageUrl}
                  alt={form.title}
                  className="w-full max-h-80 object-cover rounded-2xl border"
                />
              </div>
            )}

            <div>
              <label className="block font-bold mb-3">
                Replace Image
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setNewImageFile(event.target.files?.[0] || null)
                }
                className="w-full p-4 rounded-2xl border border-gray-300"
              />
              <p className="text-sm text-gray-500 mt-2">
                Leave this blank to keep the current image.
              </p>
            </div>

            <input
              type="text"
              placeholder="Listing Title"
              value={form.title}
              onChange={(event) =>
                updateForm("title", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <textarea
              placeholder="Description"
              value={form.description}
              onChange={(event) =>
                updateForm("description", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <input
              type="text"
              placeholder="Price"
              value={form.price}
              onChange={(event) =>
                updateForm("price", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Category"
              value={form.category}
              onChange={(event) =>
                updateForm("category", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="City"
              value={form.city}
              onChange={(event) =>
                updateForm("city", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Seller Name"
              value={form.sellerName}
              onChange={(event) =>
                updateForm("sellerName", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="email"
              placeholder="Seller Email"
              value={form.sellerEmail}
              onChange={(event) =>
                updateForm("sellerEmail", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Seller Phone"
              value={form.sellerPhone}
              onChange={(event) =>
                updateForm("sellerPhone", event.target.value)
              }
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
