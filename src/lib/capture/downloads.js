// FORGE Capture download page — version manifest and redirect resolution.
//
// One checked-in data file maps published Capture versions to their release
// assets. Cutting a new version means: publish the binaries to the GitHub
// release (see forge-capture-app/docs/packaging.md, "Binary publishing
// process"), then add one entry below. No page edits required.
//
// Binaries are NEVER stored in this repo — they live as GitHub Release
// assets (free) on onyxgolden/marketplace409. This file only records where
// to find them. The redirect route (/forge/download/capture/<version>/<filename>)
// redirects only to filenames listed here — anything else 404s, so a crafted
// URL can never turn the route into an open redirect or a path traversal.

const GITHUB_RELEASES = "https://github.com/onyxgolden/marketplace409/releases";

const releaseAssetUrl = (tag, filename) =>
  `${GITHUB_RELEASES}/download/${tag}/${encodeURIComponent(filename)}`;

export const GITHUB_RELEASES_BASE = GITHUB_RELEASES;

export const CAPTURE_DOWNLOAD_MANIFEST = {
  "v0.2.0": {
    version: "v0.2.0",
    releaseTag: "forge-capture-v0.2.0",
    releaseUrl: `${GITHUB_RELEASES}/tag/forge-capture-v0.2.0`,
    publishedAt: "2026-09-23",
    assets: [
      {
        platform: "windows",
        label: "Windows installer (.exe, NSIS, per-user)",
        filename: "FORGE-Capture_0.2.0_x64-setup.exe",
        // Not published yet — must be built on a Windows host (or CI) and
        // uploaded to the release. A null url renders as "coming soon" on
        // the download page, never a dead link.
        url: null,
      },
      {
        platform: "linux",
        label: "Linux .deb (Debian/Ubuntu)",
        filename: "FORGE Capture_0.2.0_amd64.deb",
        url: releaseAssetUrl(
          "forge-capture-v0.2.0",
          "FORGE Capture_0.2.0_amd64.deb",
        ),
      },
      {
        platform: "linux",
        label: "Linux AppImage",
        filename: "FORGE Capture_0.2.0_amd64.AppImage",
        url: releaseAssetUrl(
          "forge-capture-v0.2.0",
          "FORGE Capture_0.2.0_amd64.AppImage",
        ),
      },
    ],
  },
};

export const LATEST_CAPTURE_VERSION = "v0.2.0";

export function getCaptureRelease(version) {
  const key = String(version || "").trim();
  return CAPTURE_DOWNLOAD_MANIFEST[key] || null;
}

export function getCaptureReleases() {
  return Object.values(CAPTURE_DOWNLOAD_MANIFEST);
}

// Resolves a versioned download path to its published asset URL.
// Returns the URL string, or null when the version is unknown, the filename
// is not in the manifest for that version, or the asset is not published yet.
// Exact filename matching only — no path traversal possible.
export function resolveCaptureDownloadUrl({ version, filename }) {
  const release = getCaptureRelease(version);
  if (!release) return null;
  const asset = release.assets.find((entry) => entry.filename === filename);
  return asset?.url || null;
}
