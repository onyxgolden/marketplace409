"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function Header() {
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  async function loadUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    setUser(user);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <header className="bg-blue-900 text-white p-4 shadow-lg">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <a href="/" className="text-3xl font-bold">
          409 Marketplace
        </a>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden bg-white text-blue-900 px-4 py-2 rounded-xl font-bold"
        >
          Menu
        </button>

        <nav className="hidden md:flex gap-6 text-lg items-center">
          <a href="/" className="hover:text-blue-200">Home</a>
          <a href="/browse" className="hover:text-blue-200">Buy & Sell</a>
          <a href="/browse?category=Rentals" className="hover:text-blue-200">Rentals</a>
          <a href="/browse?category=Services" className="hover:text-blue-200">Services</a>
          <a href="/community" className="hover:text-blue-200">Community</a>
          <a href="/my-listings" className="hover:text-blue-200">My Listings</a>

          <a
            href="/import"
            className="bg-white text-blue-900 px-4 py-2 rounded-xl font-bold hover:bg-blue-100"
          >
            Import
          </a>

          <a
            href="/post"
            className="bg-red-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-red-500"
          >
            Post Free
          </a>

          {user ? (
            <>
              <span className="text-sm text-blue-200">{user.email}</span>

              <button
                onClick={handleSignOut}
                className="bg-gray-800 px-4 py-2 rounded-xl font-bold hover:bg-gray-700"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a href="/auth" className="hover:text-blue-200">Sign In</a>
          )}
        </nav>
      </div>

      {menuOpen && (
        <nav className="md:hidden mt-4 bg-blue-950 rounded-2xl p-4 space-y-3">
          <a href="/" className="block hover:text-blue-200">Home</a>
          <a href="/browse" className="block hover:text-blue-200">Buy & Sell</a>
          <a href="/browse?category=Rentals" className="block hover:text-blue-200">Rentals</a>
          <a href="/browse?category=Services" className="block hover:text-blue-200">Services</a>
          <a href="/community" className="block hover:text-blue-200">Community</a>
          <a href="/my-listings" className="block hover:text-blue-200">My Listings</a>
          <a href="/import" className="block bg-white text-blue-900 px-4 py-3 rounded-xl font-bold">Import</a>
          <a href="/post" className="block bg-red-600 text-white px-4 py-3 rounded-xl font-bold">Post Free</a>

          {user ? (
            <>
              <p className="text-sm text-blue-200">{user.email}</p>

              <button
                onClick={handleSignOut}
                className="w-full text-left bg-gray-800 px-4 py-3 rounded-xl font-bold"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a href="/auth" className="block hover:text-blue-200">Sign In</a>
          )}
        </nav>
      )}
    </header>
  );
}