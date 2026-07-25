"use client";

import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { useState } from "react";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signUp() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      alert(error.message);
    } else {
      alert("Account created. You can now post your listing.");
      window.location.href = "/post";
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

    window.location.href = "/forge/financial";
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

          <input
            className="w-full border rounded-xl px-4 py-4 mb-6"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

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
