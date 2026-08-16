"use client";
import { useState } from "react";

export default function RentalPhotoUpload({ entityType, entityId, photoUrl, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const busy = uploading || removing;

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("entityType", entityType);
      form.set("entityId", entityId);
      form.set("file", file);
      const response = await fetch("/api/rental/photo", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await onUploaded?.(body.photoUrl);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const removePhoto = async () => {
    setRemoving(true);
    setError("");
    try {
      const response = await fetch("/api/rental/photo", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType, entityId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await onUploaded?.(null);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      {photoUrl ? (
        <img src={photoUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-center text-xs font-bold text-slate-400">
          No photo
        </div>
      )}
      <div>
        <div className="flex gap-2">
          <label className="inline-block cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:border-slate-400">
            {uploading ? "Uploading…" : photoUrl ? "Replace photo" : "Add photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={upload}
              disabled={busy}
            />
          </label>
          {photoUrl && (
            <button
              type="button"
              onClick={removePhoto}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-red-700 hover:border-red-400 disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove photo"}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
