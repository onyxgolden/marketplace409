"use client";

import Header from "@/components/Header";
import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";
import { useState } from "react";

const {
  listingApplication,
} = createMarketplaceApplicationSuite();

export default function PostPage() {
  const [form, setForm] = useState(() =>
    listingApplication.getInitialListingForm(),
  );
  const [images, setImages] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [isPosting, setIsPosting] = useState(false);

  function updateForm(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleSubmit() {
    setIsPosting(true);

    const result = await listingApplication.createListing({
      form,
      imageFiles: images,
    });

    if (!result.ok) {
      alert(result.message);

      if (result.error) {
        console.log(result.error);
      }

      setIsPosting(false);

      if (result.redirectTo) {
        window.location.href = result.redirectTo;
      }

      return;
    }

    alert(result.message);
    window.location.href = result.redirectTo;
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
              value={form.title}
              onChange={(event) =>
                updateForm("title", event.target.value)
              }
            />

            <textarea
              className="border rounded-xl px-4 py-4 h-40"
              placeholder="Describe your item or service..."
              value={form.description}
              onChange={(event) =>
                updateForm("description", event.target.value)
              }
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <input
                className="border rounded-xl px-4 py-4"
                placeholder="Price"
                value={form.price}
                onChange={(event) =>
                  updateForm("price", event.target.value)
                }
              />

              <select
                className="border rounded-xl px-4 py-4"
                value={form.category}
                onChange={(event) =>
                  updateForm("category", event.target.value)
                }
              >
                <option value="">Select Category</option>
                <option>Vehicles</option>
                <option>Rentals</option>
                <option>Services</option>
                <option>Farm & Ranch</option>
                <option>Pets</option>
                <option value="Electronics">Electronics</option>
                <option value="Music & Instruments">
                  Music & Instruments
                </option>
                <option value="Boats & Marine">Boats & Marine</option>
                <option value="Hunting & Fishing">
                  Hunting & Fishing
                </option>
                <option value="Tools & Equipment">
                  Tools & Equipment
                </option>
                <option value="Miscellaneous">Miscellaneous</option>
              </select>
            </div>

            <input
              className="border rounded-xl px-4 py-4"
              placeholder="City or ZIP"
              value={form.city}
              onChange={(event) =>
                updateForm("city", event.target.value)
              }
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <input
                className="border rounded-xl px-4 py-4"
                placeholder="Seller Name"
                value={form.sellerName}
                onChange={(event) =>
                  updateForm("sellerName", event.target.value)
                }
              />

              <input
                className="border rounded-xl px-4 py-4"
                placeholder="Seller Email"
                value={form.sellerEmail}
                onChange={(event) =>
                  updateForm("sellerEmail", event.target.value)
                }
              />
            </div>

            <input
              className="border rounded-xl px-4 py-4"
              placeholder="Seller Phone"
              value={form.sellerPhone}
              onChange={(event) =>
                updateForm("sellerPhone", event.target.value)
              }
            />

            <div className="border-2 border-dashed rounded-2xl p-10 text-center bg-gray-50">
              <p className="text-lg font-semibold mb-3">
                📸 Upload Photo
              </p>

              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);

                  setImages(files);
                  setImagePreviews(
                    files.map((file) => URL.createObjectURL(file)),
                  );
                }}
              />

              {imagePreviews.length > 0 && (
                <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
                  {imagePreviews.map((preview, index) => (
                    <img
                      key={preview}
                      src={preview}
                      alt={`Preview ${index + 1}`}
                      className="h-32 w-full object-cover rounded-2xl shadow"
                    />
                  ))}
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
