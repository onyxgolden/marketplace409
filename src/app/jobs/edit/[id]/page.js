"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";

const {
  jobApplication,
} = createMarketplaceApplicationSuite();

export default function EditJobPage({ params }) {
  const [jobId, setJobId] = useState("");
  const [form, setForm] = useState(() =>
    jobApplication.getInitialJobForm(),
  );
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      const resolvedJobId = resolvedParams.id;

      setJobId(resolvedJobId);

      const result = await jobApplication.loadJob(resolvedJobId);

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

    const result = await jobApplication.updateJob({
      jobId,
      form,
    });

    setIsSaving(false);

    if (!result.ok) {
      alert(result.message);
      console.log(result.error);
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
            Loading job...
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
          <h1 className="text-4xl font-extrabold mb-8">Edit Job</h1>

          <div className="space-y-4">
            <input
              value={form.jobTitle}
              onChange={(event) =>
                updateField("jobTitle", event.target.value)
              }
              placeholder="Job Title"
              className="w-full p-4 border rounded-xl"
            />

            <input
              value={form.companyName}
              onChange={(event) =>
                updateField("companyName", event.target.value)
              }
              placeholder="Company Name"
              className="w-full p-4 border rounded-xl"
            />

            <input
              value={form.city}
              onChange={(event) =>
                updateField("city", event.target.value)
              }
              placeholder="City"
              className="w-full p-4 border rounded-xl"
            />

            <input
              value={form.category}
              onChange={(event) =>
                updateField("category", event.target.value)
              }
              placeholder="Category"
              className="w-full p-4 border rounded-xl"
            />

            <input
              value={form.employmentType}
              onChange={(event) =>
                updateField("employmentType", event.target.value)
              }
              placeholder="Employment Type"
              className="w-full p-4 border rounded-xl"
            />

            <input
              value={form.payRange}
              onChange={(event) =>
                updateField("payRange", event.target.value)
              }
              placeholder="Pay Range"
              className="w-full p-4 border rounded-xl"
            />

            <label className="flex items-center gap-3 bg-gray-100 p-4 rounded-2xl">
              <input
                type="checkbox"
                checked={form.communityJobPosting}
                onChange={(event) =>
                  updateField(
                    "communityJobPosting",
                    event.target.checked,
                  )
                }
              />

              <span className="font-bold">Community Job Posting</span>
            </label>

            <textarea
              value={form.description}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
              placeholder="Description"
              className="w-full p-4 border rounded-xl h-32"
            />

            <textarea
              value={form.requirements}
              onChange={(event) =>
                updateField("requirements", event.target.value)
              }
              placeholder="Requirements"
              className="w-full p-4 border rounded-xl h-24"
            />

            <input
              value={form.contactPhone}
              onChange={(event) =>
                updateField("contactPhone", event.target.value)
              }
              placeholder="Contact Phone"
              className="w-full p-4 border rounded-xl"
            />

            <input
              value={form.contactEmail}
              onChange={(event) =>
                updateField("contactEmail", event.target.value)
              }
              placeholder="Contact Email"
              className="w-full p-4 border rounded-xl"
            />

            <input
              value={form.applyUrl}
              onChange={(event) =>
                updateField("applyUrl", event.target.value)
              }
              placeholder="Apply URL"
              className="w-full p-4 border rounded-xl"
            />

            <button
              onClick={handleUpdate}
              disabled={isSaving}
              className="w-full bg-blue-900 text-white py-4 rounded-xl font-bold disabled:bg-gray-400"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
