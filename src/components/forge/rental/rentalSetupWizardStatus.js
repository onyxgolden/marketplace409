// Setup-wizard status helpers, split out of RentalSetupWizardPanel so the
// shell can read the dismissal flag + status WITHOUT statically importing the
// (heavy) wizard panel itself — Slice 1 demand-loads the panel with
// next/dynamic, and this tiny module is all the shell's first-run gate needs.
//
// Dismissal persists in localStorage (deliberately not a migration): it is a
// per-browser UI preference, not workspace data, and the wizard re-appears on a
// fresh device until that browser is dismissed too — acceptable for a one-time
// tour, and the Setup guide entry under Settings always offers a re-run.
export const SETUP_WIZARD_DISMISSAL_STORAGE_KEY = "forge-rental-setup-wizard-dismissed:v1";

export function readSetupWizardDismissal() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSetupWizardDismissal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETUP_WIZARD_DISMISSAL_STORAGE_KEY, "1");
  } catch {
    // Storage unavailable — the wizard simply shows again next load.
  }
}

export async function fetchSetupWizardStatus() {
  const response = await fetch("/api/rental/setup-wizard-status");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load setup progress.");
  return body;
}
