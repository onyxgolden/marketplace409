import {
  THEME_DARK_CLASS,
  THEME_STORAGE_KEY,
  isThemePreference,
} from "@/lib/theme/constants";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function getSystemTheme() {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }

  return window.matchMedia(SYSTEM_DARK_QUERY).matches
    ? "dark"
    : "light";
}

export function resolveEffectiveTheme(preference, systemTheme) {
  if (preference === "dark" || preference === "light") {
    return preference;
  }

  return systemTheme ?? getSystemTheme();
}

export function readStoredThemePreference() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredThemePreference(preference) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private browsing, quota); preference
    // still applies for the current session via in-memory state.
  }
}

export function applyEffectiveTheme(effectiveTheme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.classList.toggle(THEME_DARK_CLASS, effectiveTheme === "dark");
  root.style.colorScheme = effectiveTheme;
}
