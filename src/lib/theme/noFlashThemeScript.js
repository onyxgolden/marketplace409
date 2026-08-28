import { THEME_DARK_CLASS, THEME_STORAGE_KEY } from "@/lib/theme/constants";

// Runs synchronously before first paint (see src/app/layout.js) so the
// resolved theme class is on <html> before React hydrates. Keep this a
// standalone string, not an import of the shared resolve helpers, since it
// must execute before any application JS module has loaded.
export function buildNoFlashThemeScript() {
  return `(function(){try{var e=window.localStorage.getItem("${THEME_STORAGE_KEY}");var d=e==="dark"||(e!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var c=document.documentElement.classList;if(d){c.add("${THEME_DARK_CLASS}")}else{c.remove("${THEME_DARK_CLASS}")}document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})();`;
}
