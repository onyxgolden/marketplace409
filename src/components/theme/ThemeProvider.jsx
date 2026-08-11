"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { isThemePreference } from "@/lib/theme/constants";
import {
  applyEffectiveTheme,
  getSystemTheme,
  readStoredThemePreference,
  resolveEffectiveTheme,
  writeStoredThemePreference,
} from "@/lib/theme/resolveTheme";

const ThemeContext = createContext(null);

export default function ThemeProvider({ children }) {
  const [preference, setPreference] = useState("system");
  const [systemTheme, setSystemTheme] = useState(() => getSystemTheme());

  useEffect(() => {
    // Restored after mount (not via a lazy useState initializer) so the
    // first client render matches the server-rendered markup before
    // hydration; the no-flash script (see src/app/layout.js) already
    // applied the correct class to <html> ahead of this.
    const stored = readStoredThemePreference();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a value from an external store (localStorage) on mount.
      setPreference(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return undefined;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveEffectiveTheme(preference, systemTheme),
    [preference, systemTheme],
  );

  useEffect(() => {
    applyEffectiveTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setThemePreference = (next) => {
    if (!isThemePreference(next)) {
      return;
    }

    setPreference(next);
    writeStoredThemePreference(next);
  };

  const value = useMemo(
    () => ({ preference, resolvedTheme, setThemePreference }),
    [preference, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
