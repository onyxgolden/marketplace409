import { NextResponse } from "next/server";
import { createPublicListingClient } from "@/lib/supabase/createPublicListingClient";

export const runtime = "nodejs";

// Public (no login) photo for a published listing. The requested path must
// be one of the listing's own snapshotted photos — anything else 404s, so
// this can never be used to probe the storage bucket.
const ALLOWED_TYPES = { "image/jpeg": true, "image/png": true, "image/webp": true };

export async function GET(request, { params }) {
  try {
    const slug = (await params).slug;
    if (!/^[a-zA-Z0-9]{12}$/.test(slug)) {
      return NextResponse.json({ error: "Photo was not found." }, { status: 404 });
    }
    const path = new URL(request.url).searchParams.get("path") || "";
    if (!path || path.includes("..")) return NextResponse.json({ error: "Photo was not found." }, { status: 404 });

    const supabase = createPublicListingClient();
    const { data: listing, error } = await supabase
      .from("rental_listings").select("id, owner_id, photos")
      .eq("public_slug", slug).eq("status", "published").maybeSingle();
    if (error) throw error;
    if (!listing) return NextResponse.json({ error: "Photo was not found." }, { status: 404 });

    const photos = Array.isArray(listing.photos) ? listing.photos : [];
    const match = photos.find((photo) => photo?.path === path);
    if (!match?.bucket) return NextResponse.json({ error: "Photo was not found." }, { status: 404 });

    const { data, error: downloadError } = await supabase.storage.from(match.bucket).download(path);
    if (downloadError || !data) throw downloadError || new Error("download failed");
    const contentType = data.type && ALLOWED_TYPES[data.type] ? data.type : "application/octet-stream";
    return new NextResponse(data, {
      status: 200,
      headers: { "content-type": contentType, "cache-control": "public, max-age=86400" },
    });
  } catch (error) {
    console.error("Public listing photo error", error);
    return NextResponse.json({ error: "Photo was not found." }, { status: 404 });
  }
}
