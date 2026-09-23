import { NextResponse } from "next/server";
import { resolveCaptureDownloadUrl } from "@/lib/capture/downloads";

// Versioned Capture download path:
//   /forge/download/capture/<version>/<filename>  (e.g. v0.2.0/FORGE Capture_0.2.0_amd64.deb)
//
// Only filenames listed in the checked-in manifest redirect; anything else
// 404s. The binaries themselves are GitHub Release assets — this route is
// just a stable, versioned permalink to them.
export async function GET(_request, { params }) {
  const { version, filename } = await params;
  const url = resolveCaptureDownloadUrl({ version, filename });
  if (!url) {
    return NextResponse.json(
      { error: "That download was not found." },
      { status: 404 },
    );
  }
  return NextResponse.redirect(url, 302);
}
