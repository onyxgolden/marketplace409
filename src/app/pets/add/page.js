"use client";

import { useState } from "react";
import Header from "@/components/Header";
import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";

const {
  petApplication,
} = createMarketplaceApplicationSuite();

export default function AddPetPage() {
  const [form, setForm] = useState(() =>
    petApplication.getInitialPetForm(),
  );
  const [imageFile, setImageFile] = useState(null);
  const [isPosting, setIsPosting] = useState(false);

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function updatePostType(postType) {
    setForm((currentForm) => ({
      ...currentForm,
      postType,
      petOfWeekEligible:
        postType === "Lost Pet" || postType === "Found Pet"
          ? false
          : currentForm.petOfWeekEligible,
    }));
  }

  async function handleSubmit() {
    setIsPosting(true);

    const result = await petApplication.createPet({
      form,
      imageFile,
    });

    if (!result.ok) {
      alert(result.message);

      if (result.error) {
        console.log(result.error);
      }

      if (result.redirectTo) {
        window.location.href = result.redirectTo;
        return;
      }

      setIsPosting(false);
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
          <h1 className="text-4xl font-extrabold mb-8">Add Pet Post</h1>

          <div className="space-y-6">
            <input
              type="text"
              placeholder="Pet Name"
              value={form.petName}
              onChange={(event) =>
                updateField("petName", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={form.postType}
              onChange={(event) => updatePostType(event.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Select Post Type</option>
              <option value="Adoptable Pet">Adoptable Pet</option>
              <option value="Lost Pet">Lost Pet</option>
              <option value="Found Pet">Found Pet</option>
              <option value="Personal Pet">Personal Pet</option>
            </select>

            {form.postType !== "Lost Pet" &&
              form.postType !== "Found Pet" &&
              form.postType !== "" && (
                <label className="flex items-center gap-3 text-lg font-bold">
                  <input
                    type="checkbox"
                    checked={form.petOfWeekEligible}
                    onChange={(event) =>
                      updateField(
                        "petOfWeekEligible",
                        event.target.checked,
                      )
                    }
                    className="w-5 h-5"
                  />
                  Enter this pet for Pet of the Week
                </label>
              )}

            <select
              value={form.petType}
              onChange={(event) =>
                updateField("petType", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Select Pet Type</option>
              <option value="Dog">Dog</option>
              <option value="Cat">Cat</option>
              <option value="Bird">Bird</option>
              <option value="Horse">Horse</option>
              <option value="Livestock">Livestock</option>
              <option value="Other">Other</option>
            </select>

            <textarea
              placeholder="Description"
              value={form.description}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <input
              type="text"
              placeholder="Contact Name"
              value={form.contactName}
              onChange={(event) =>
                updateField("contactName", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Contact Phone"
              value={form.contactPhone}
              onChange={(event) =>
                updateField("contactPhone", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="email"
              placeholder="Contact Email"
              value={form.contactEmail}
              onChange={(event) =>
                updateField("contactEmail", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="City"
              value={form.city}
              onChange={(event) =>
                updateField("city", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                setImageFile(event.target.files?.[0] || null)
              }
            />

            <button
              onClick={handleSubmit}
              disabled={isPosting}
              className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500 disabled:bg-gray-400"
            >
              {isPosting ? "Posting..." : "Add Pet Post"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
