export const THEME_STORAGE_KEY = "forge-theme-preference";

export const THEME_DARK_CLASS = "dark";

export const THEME_PREFERENCES = Object.freeze([
  "light",
  "dark",
  "system",
]);

export function isThemePreference(value) {
  return THEME_PREFERENCES.includes(value);
}
