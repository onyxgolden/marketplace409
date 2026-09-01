"use client";

import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

const supabase = createClient();
function nextDestination() {
  const requested = new URLSearchParams(window.location.search).get("next");
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/forge/financial";
}

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  async function signUp() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      alert(error.message);
    } else {
      alert("Account created. Check your email if confirmation is required, then sign in.");
      window.location.href = nextDestination();
    }
  }

  async function signIn() {
    const result = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    console.log("SIGN IN RESULT", result);

    if (result.error) {
      alert(result.error.message);
      return;
    }

    const session = result.data?.session;
    const user = result.data?.user;

    console.log("SESSION", session);
    console.log("USER", user);

    alert(
      `Signed in\nSession: ${session ? "YES" : "NO"}\nUser: ${
        user?.id ?? "NONE"
      }`,
    );

    window.location.href = nextDestination();
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
    } else {
      alert("Signed out.");
      window.location.href = "/";
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessage("Enter your email address first, then select Forgot password?");
      return;
    }

    setResettingPassword(true);
    setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setResettingPassword(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Check your email for a secure password-reset link.");
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-md mx-auto py-16 px-6">
        <div className="bg-white rounded-3xl shadow-xl p-8">
          <h1 className="text-4xl font-extrabold mb-4">Sign In</h1>

          <p className="text-gray-600 mb-8">
            Create an account or sign in to manage your listings.
          </p>

          <input
            className="w-full border rounded-xl px-4 py-4 mb-4"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="relative mb-2">
            <input
              className="w-full border rounded-xl px-4 py-4 pr-20"
              placeholder="Password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute inset-y-0 right-0 px-4 font-semibold text-blue-900"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          <button
            type="button"
            onClick={resetPassword}
            disabled={resettingPassword}
            className="mb-6 text-sm font-semibold text-blue-900 underline disabled:opacity-60"
          >
            {resettingPassword ? "Sending reset link…" : "Forgot password?"}
          </button>

          {message ? (
            <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
              {message}
            </p>
          ) : null}

          <button
            onClick={signIn}
            className="w-full bg-blue-900 text-white py-4 rounded-2xl text-xl font-bold mb-4"
          >
            Sign In
          </button>

          <button
            onClick={signUp}
            className="w-full bg-red-600 text-white py-4 rounded-2xl text-xl font-bold"
          >
            Create Account
          </button>

          <button
            onClick={signOut}
            className="w-full bg-gray-800 text-white py-4 rounded-2xl text-xl font-bold mt-4"
          >
            Sign Out
          </button>
        </div>
      </section>
    </main>
  );
}
