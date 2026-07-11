"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { BusinessClaimApplication } from "@/application/business";
import { BusinessClaimRepository } from "@/domains/business-claims/business-claim.repository";
import { BusinessClaimService } from "@/domains/business-claims/business-claim.service";

const businessClaimApplication = new BusinessClaimApplication({
  service: new BusinessClaimService(new BusinessClaimRepository()),
});

export default function ClaimBusinessPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const businessId = params.id;
  const businessName = searchParams.get("name") || "";

  const [form, setForm] = useState(() =>
    businessClaimApplication.getInitialBusinessClaimForm(),
  );
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  function updateField(e) {
    const { name, value, type, checked } = e.target;

    setForm((previousForm) => ({
      ...previousForm,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const result = await businessClaimApplication.submitClaim({
      businessId,
      businessName,
      form,
    });

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-3xl font-bold">Claim Request Submitted</h1>

        <p className="mt-4 text-gray-700">
          Thanks. Your claim request has been submitted for review.
        </p>

        <p className="mt-2 text-gray-700">
          We may contact you or call the publicly listed business phone number
          to confirm ownership.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Claim This Business</h1>

      <p className="mt-2 text-gray-600">Request ownership access for:</p>

      <p className="mt-1 text-xl font-semibold">
        {businessName || "This business"}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <input
          name="claimant_name"
          value={form.claimant_name}
          onChange={updateField}
          required
          placeholder="Your full name"
          className="w-full rounded border p-3"
        />

        <input
          name="title"
          value={form.title}
          onChange={updateField}
          placeholder="Your title / position"
          className="w-full rounded border p-3"
        />

        <input
          name="email"
          type="email"
          value={form.email}
          onChange={updateField}
          required
          placeholder="Email address"
          className="w-full rounded border p-3"
        />

        <input
          name="phone"
          value={form.phone}
          onChange={updateField}
          required
          placeholder="Phone number"
          className="w-full rounded border p-3"
        />

        <input
          name="website"
          value={form.website}
          onChange={updateField}
          placeholder="Business website optional"
          className="w-full rounded border p-3"
        />

        <input
          name="facebook_url"
          value={form.facebook_url}
          onChange={updateField}
          placeholder="Business Facebook page optional"
          className="w-full rounded border p-3"
        />

        <textarea
          name="notes"
          value={form.notes}
          onChange={updateField}
          placeholder="Anything we should know?"
          className="w-full rounded border p-3"
          rows="4"
        />

        <label className="flex gap-3 text-sm text-gray-700">
          <input
            type="checkbox"
            name="certified"
            checked={form.certified}
            onChange={updateField}
          />

          <span>
            I certify that I am authorized to represent this business.
          </span>
        </label>

        {error && <p className="text-red-600">{error}</p>}

        <button
          type="submit"
          className="rounded bg-black px-5 py-3 font-semibold text-white"
        >
          Submit Claim Request
        </button>
      </form>
    </main>
  );
}
