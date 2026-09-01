"use client";

import { useEffect, useState } from "react";
import {
  Handshake,
  HardHat,
  Home,
  Menu,
  Plus,
  ShoppingCart,
  Store,
  ClipboardList,
  Hammer,
  Building2,
} from "lucide-react";

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
    <header className="bg-slate-950 text-white p-4 shadow-lg">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <a href="/" className="text-3xl font-bold">
          409Marketplace
        </a>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden flex items-center gap-2 bg-white text-slate-950 px-4 py-2 rounded-xl font-bold"
        >
          <Menu aria-hidden="true" className="h-4 w-4" />
          Menu
        </button>

        <nav className="hidden md:flex gap-6 text-lg items-center ml-12">
          <a href="/" className="flex items-center gap-1.5 hover:text-amber-400">
            <Home aria-hidden="true" className="h-4 w-4" />
            Home
          </a>
          <a href="/browse" className="flex items-center gap-1.5 hover:text-amber-400">
            <ShoppingCart aria-hidden="true" className="h-4 w-4" />
            Buy/Sell
          </a>
          <a
            href="/browse?category=Rentals"
            className="flex items-center gap-1.5 hover:text-amber-400"
          >
            <Building2 aria-hidden="true" className="h-4 w-4" />
            Rentals
          </a>
          <a href="/investors" className="flex items-center gap-1.5 hover:text-amber-400">
            <HardHat aria-hidden="true" className="h-4 w-4" />
            Investors
          </a>
          <a href="/community" className="flex items-center gap-1.5 hover:text-amber-400">
            <Handshake aria-hidden="true" className="h-4 w-4" />
            Community
          </a>
          <a href="/businesses" className="flex items-center gap-1.5 hover:text-amber-400">
            <Store aria-hidden="true" className="h-4 w-4" />
            Businesses
          </a>
          <a href="/my-listings" className="flex items-center gap-1.5 hover:text-amber-400">
            <ClipboardList aria-hidden="true" className="h-4 w-4" />
            My Listings
          </a>

          <a
            href="/forge"
            className="flex items-center gap-1.5 bg-amber-400 text-slate-950 px-4 py-2 rounded-xl font-black hover:bg-amber-300"
          >
            <Hammer aria-hidden="true" className="h-4 w-4" />
            Launch FORGE
          </a>

          <a
            href="/post"
            className="flex items-center gap-1.5 bg-amber-500 text-slate-950 px-4 py-2 rounded-xl font-bold hover:bg-amber-400"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Post Free
          </a>

          {user ? (
            <>
              <span className="text-sm text-slate-300">{user.email}</span>

              <button
                onClick={handleSignOut}
                className="bg-slate-800 px-4 py-2 rounded-xl font-bold hover:bg-slate-700"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a href="/auth" className="hover:text-amber-400">
              Sign In
            </a>
          )}
        </nav>
      </div>

      {menuOpen && (
        <nav className="md:hidden mt-4 bg-slate-900 rounded-2xl p-4 space-y-3">
          <a href="/" className="flex items-center gap-2 hover:text-amber-400">
            <Home aria-hidden="true" className="h-4 w-4" />
            Home
          </a>
          <a href="/browse" className="flex items-center gap-2 hover:text-amber-400">
            <ShoppingCart aria-hidden="true" className="h-4 w-4" />
            Buy/Sell
          </a>
          <a
            href="/browse?category=Rentals"
            className="flex items-center gap-2 hover:text-amber-400"
          >
            <Building2 aria-hidden="true" className="h-4 w-4" />
            Rentals
          </a>

          <a href="/investors" className="flex items-center gap-2 hover:text-amber-400">
            <HardHat aria-hidden="true" className="h-4 w-4" />
            Investors
          </a>
          <a href="/community" className="flex items-center gap-2 hover:text-amber-400">
            <Handshake aria-hidden="true" className="h-4 w-4" />
            Community
          </a>
          <a href="/businesses" className="flex items-center gap-2 hover:text-amber-400">
            <Store aria-hidden="true" className="h-4 w-4" />
            Businesses
          </a>
          <a href="/my-listings" className="flex items-center gap-2 hover:text-amber-400">
            <ClipboardList aria-hidden="true" className="h-4 w-4" />
            My Listings
          </a>
          <a
            href="/forge"
            className="flex items-center gap-2 bg-amber-400 text-slate-950 px-4 py-3 rounded-xl font-black"
          >
            <Hammer aria-hidden="true" className="h-4 w-4" />
            Launch FORGE
          </a>
          <a
            href="/post"
            className="flex items-center gap-2 bg-amber-500 text-slate-950 px-4 py-3 rounded-xl font-bold"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Post Free
          </a>

          {user ? (
            <>
              <p className="text-sm text-slate-300">{user.email}</p>

              <button
                onClick={handleSignOut}
                className="w-full text-left bg-slate-800 px-4 py-3 rounded-xl font-bold"
              >
                Sign Out
              </button>
            </>
          ) : (
            <a href="/auth" className="block hover:text-amber-400">
              Sign In
            </a>
          )}
        </nav>
      )}
    </header>
  );
}
