"use client";

import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

const supabase = createClient();

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function updatePassword() {
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      return;
    }

    setSaving(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Password updated. You can now sign in with your new password.");
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <section className="mx-auto max-w-md px-6 py-16">
        <div className="rounded-3xl bg-white p-8 shadow-xl">
          <h1 className="mb-4 text-4xl font-extrabold">Reset password</h1>
          <p className="mb-8 text-gray-600">Choose a new password for your 409 Marketplace account.</p>

          <div className="relative mb-4">
            <input
              aria-label="New password"
              className="w-full rounded-xl border px-4 py-4 pr-20"
              placeholder="New password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute inset-y-0 right-0 px-4 font-semibold text-blue-900"
              aria-label={showPassword ? "Hide passwords" : "Show passwords"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          <input
            aria-label="Confirm new password"
            className="mb-6 w-full rounded-xl border px-4 py-4"
            placeholder="Confirm new password"
            type={showPassword ? "text" : "password"}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />

          {message ? <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">{message}</p> : null}

          <button
            type="button"
            onClick={updatePassword}
            disabled={saving}
            className="w-full rounded-2xl bg-blue-900 py-4 text-xl font-bold text-white disabled:opacity-60"
          >
            {saving ? "Updating password…" : "Update password"}
          </button>

          <a href="/auth" className="mt-5 block text-center font-semibold text-blue-900 underline">Return to sign in</a>
        </div>
      </section>
    </main>
  );
}
