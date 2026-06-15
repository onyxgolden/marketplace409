"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export default function EditJobPage({ params }) {
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(true);

  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [payRange, setPayRange] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [applyUrl, setApplyUrl] = useState("");
  const [communityJobPosting, setCommunityJobPosting] = useState(false);

  useEffect(() => {
    async function start() {
      const resolvedParams = await params;
      setJobId(resolvedParams.id);
      loadJob(resolvedParams.id);
    }

    start();
  }, [params]);

  async function loadJob(id) {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      alert("Job not found");
      window.location.href = "/jobs";
      return;
    }

    setJobTitle(data.job_title || "");
    setCompanyName(data.company_name || "");
    setCity(data.city || "");
    setCategory(data.category || "");
    setEmploymentType(data.employment_type || "");
    setPayRange(data.pay_range || "");
    setDescription(data.description || "");
    setRequirements(data.requirements || "");
    setContactPhone(data.contact_phone || "");
    setContactEmail(data.contact_email || "");
    setApplyUrl(data.apply_url || "");
    setCommunityJobPosting(data.community_job_posting || false);

    setLoading(false);
  }

  async function handleUpdate() {
    const { error } = await supabase
      .from("jobs")
      .update({
        job_title: jobTitle,
        company_name: companyName,
        city,
        category,
        employment_type: employmentType,
        pay_range: payRange,
        description,
        requirements,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        apply_url: applyUrl,
        community_job_posting: communityJobPosting,
      })
      .eq("id", jobId);

    if (error) {
      alert("Error updating job");
      console.log(error);
    } else {
      alert("Job updated!");
      window.location.href = "/jobs";
    }
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
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Job Title"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Company Name"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              placeholder="Employment Type"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={payRange}
              onChange={(e) => setPayRange(e.target.value)}
              placeholder="Pay Range"
              className="w-full p-4 border rounded-xl"
            />
            <label className="flex items-center gap-3 bg-gray-100 p-4 rounded-2xl">
              <input
                type="checkbox"
                checked={communityJobPosting}
                onChange={(e) => setCommunityJobPosting(e.target.checked)}
              />

              <span className="font-bold">Community Job Posting</span>
            </label>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              className="w-full p-4 border rounded-xl h-32"
            />
            <textarea
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="Requirements"
              className="w-full p-4 border rounded-xl h-24"
            />

            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Contact Phone"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="Contact Email"
              className="w-full p-4 border rounded-xl"
            />
            <input
              value={applyUrl}
              onChange={(e) => setApplyUrl(e.target.value)}
              placeholder="Apply URL"
              className="w-full p-4 border rounded-xl"
            />

            <button
              onClick={handleUpdate}
              className="w-full bg-blue-900 text-white py-4 rounded-xl font-bold"
            >
              Save Changes
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
