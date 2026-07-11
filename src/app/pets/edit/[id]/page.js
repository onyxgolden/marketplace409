"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";

const {
  petApplication,
} = createMarketplaceApplicationSuite();

export default function EditPetPage({ params }) {
  const [petId, setPetId] = useState("");
  const [form, setForm] = useState(() =>
    petApplication.getInitialPetForm(),
  );
  const [newImageFile, setNewImageFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      const resolvedPetId = resolvedParams.id;

      setPetId(resolvedPetId);

      const result = await petApplication.loadPet(resolvedPetId);

      if (!result.ok) {
        alert(result.message);
        window.location.href = result.redirectTo;
        return;
      }

      setForm(result.form);
      setLoading(false);
    }

    start();
  }, [params]);

  async function handleUpdate() {
    setIsSaving(true);

    const result = await petApplication.updatePet({
      petId,
      form,
      imageFile: newImageFile,
    });

    setIsSaving(false);

    if (!result.ok) {
      alert(result.message);

      if (result.error) {
        console.log(result.error);
      }

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
            Loading pet post...
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
          <h1 className="text-4xl font-extrabold mb-8">Edit Pet Post</h1>

          <div className="space-y-6">
            {form.imageUrl && (
              <div>
                <label className="block font-bold mb-3">Current Image</label>
                <img
                  src={form.imageUrl}
                  alt={form.petName}
                  className="w-full max-h-80 object-cover rounded-2xl border"
                />
              </div>
            )}

            <div>
              <label className="block font-bold mb-3">Replace Image</label>
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

            <button
              onClick={handleUpdate}
              disabled={isSaving}
              className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500 disabled:bg-gray-400"
            >
              {isSaving ? "Saving..." : "Save Pet Changes"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
