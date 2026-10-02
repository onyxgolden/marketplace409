"use client";
import { useCallback, useEffect, useState } from "react";

// R17: the "view as" preview banner. Rendered at the top of the Rental Manager shell whenever
// the owner/co-owner is previewing the app as a team member. Preview is READ-ONLY: every
// mutation API route denies writes while a preview session is active, so this banner is the
// visible half of that safety story -- the actor always knows they are not acting as themselves.
export default function RentalPreviewBanner() {
  const [preview, setPreview] = useState(null);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rental/team/preview", { credentials: "same-origin" });
      const body = await response.json();
      setPreview(body?.preview || null);
    } catch {
      setPreview(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial preview-state fetch when the banner mounts; subsequent refreshes come from the forge:team-preview-change event.
    load();
    const onPreviewChange = () => load();
    window.addEventListener("forge:team-preview-change", onPreviewChange);
    return () => window.removeEventListener("forge:team-preview-change", onPreviewChange);
  }, [load]);

  async function endPreview() {
    setEnding(true);
    try {
      await fetch("/api/rental/team/preview", { method: "DELETE", credentials: "same-origin" });
    } finally {
      setEnding(false);
      setPreview(null);
      window.dispatchEvent(new Event("forge:team-preview-change"));
      window.dispatchEvent(new Event("forge:team-permissions-change"));
    }
  }

  if (!preview) return null;

  return (
    <div
      role="alert"
      data-rental-preview-banner
      className="border-b-4 border-amber-500 bg-amber-100 px-4 py-3 text-amber-950 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold">
          <span aria-hidden="true" className="mr-2">👁</span>
          Previewing as {preview.email} ({preview.roleLabel}) — read-only. Nothing you click here
          will change anything; mutations are blocked while previewing.
        </p>
        <button
          type="button"
          onClick={endPreview}
          disabled={ending}
          className="rounded-full bg-amber-950 px-4 py-2 text-sm font-black text-amber-50 hover:bg-amber-900 disabled:opacity-50 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300"
        >
          {ending ? "Ending…" : "End preview"}
        </button>
      </div>
    </div>
  );
}
