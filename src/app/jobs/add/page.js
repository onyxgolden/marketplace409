"use client";

import { useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default function AddJobPage() {
  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [payRange, setPayRange] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [applyUrl, setApplyUrl] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  async function handleSubmit() {
    setIsPosting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please create a free account before posting a job.");
      window.location.href = "/auth";
      return;
    }

    const { error } = await supabase.from("jobs").insert([
      {
        job_title: jobTitle,
        company_name: companyName,
        category,
        city,
        employment_type: employmentType,
        pay_range: payRange,
        description,
        requirements,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        apply_url: applyUrl,
      },
    ]);

    if (error) {
      alert("Error posting job");
      console.log(error);
      setIsPosting(false);
    } else {
      alert("Job posted!");
      window.location.href = "/jobs";
    }
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
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Company Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
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
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
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

            <input
              type="text"
              placeholder="Pay Range, e.g. $18-$25/hr"
              value={payRange}
              onChange={(e) => setPayRange(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <textarea
              placeholder="Job Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300 h-40"
            />

            <textarea
              placeholder="Requirements"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300 h-32"
            />

            <input
              type="text"
              placeholder="Contact Name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Contact Phone"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="email"
              placeholder="Contact Email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full p-4 rounded-2xl border border-gray-300"
            />

            <input
              type="text"
              placeholder="Apply URL"
              value={applyUrl}
              onChange={(e) => setApplyUrl(e.target.value)}
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