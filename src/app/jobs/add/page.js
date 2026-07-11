"use client";

import { useState } from "react";
import Header from "@/components/Header";
import {
  createMarketplaceApplicationSuite,
} from "@/infrastructure/composition";

const {
  jobApplication,
} = createMarketplaceApplicationSuite();

export default function AddJobPage() {
  const [form, setForm] = useState(() =>
    jobApplication.getInitialJobForm(),
  );
  const [isPosting, setIsPosting] = useState(false);

  function updateField(field, value) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  async function handleSubmit() {
    setIsPosting(true);

    const result = await jobApplication.createJob(form);

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
          <h1 className="text-4xl font-extrabold mb-8">Post a Local Job</h1>

          <div className="space-y-6">
            <input
              type="text"
              placeholder="Job Title"
              value={form.jobTitle}
              onChange={(event) =>
                updateField("jobTitle", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Company Name"
              value={form.companyName}
              onChange={(event) =>
                updateField("companyName", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={form.category}
              onChange={(event) =>
                updateField("category", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Select Category</option>
              <option value="Construction">Construction</option>
              <option value="Industrial">Industrial</option>
              <option value="Oil & Gas">Oil & Gas</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Retail">Retail</option>
              <option value="Food Service">Food Service</option>
              <option value="Office/Admin">Office/Admin</option>
              <option value="Driving/Delivery">Driving/Delivery</option>
              <option value="Skilled Trades">Skilled Trades</option>
              <option value="General Labor">General Labor</option>
              <option value="Part-Time">Part-Time</option>
              <option value="Side Work">Side Work</option>
              <option value="Other">Other</option>
            </select>

            <input
              type="text"
              placeholder="City"
              value={form.city}
              onChange={(event) =>
                updateField("city", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={form.employmentType}
              onChange={(event) =>
                updateField("employmentType", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            >
              <option value="">Employment Type</option>
              <option value="Full-Time">Full-Time</option>
              <option value="Part-Time">Part-Time</option>
              <option value="Contract">Contract</option>
              <option value="Temporary">Temporary</option>
              <option value="Seasonal">Seasonal</option>
              <option value="Side Job">Side Job</option>
            </select>

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

            <input
              type="text"
              placeholder="Pay Range, e.g. $18-$25/hr"
              value={form.payRange}
              onChange={(event) =>
                updateField("payRange", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <textarea
              placeholder="Job Description"
              value={form.description}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <textarea
              placeholder="Requirements"
              value={form.requirements}
              onChange={(event) =>
                updateField("requirements", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300 h-32"
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
              placeholder="Apply URL"
              value={form.applyUrl}
              onChange={(event) =>
                updateField("applyUrl", event.target.value)
              }
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <button
              onClick={handleSubmit}
              disabled={isPosting}
              className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold hover:bg-red-500 disabled:bg-gray-400"
            >
              {isPosting ? "Posting..." : "Post Job"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
