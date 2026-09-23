import Link from "next/link";

import {
  LATEST_CAPTURE_VERSION,
  getCaptureRelease,
} from "@/lib/capture/downloads";

export const metadata = {
  title: "Download FORGE Capture | FORGE",
  description:
    "Download the FORGE Capture desktop app — local-first screen capture for Windows and Linux. No account, no upload, nothing leaves your machine.",
};

// Customer-facing FORGE Capture download page. Windows is first and primary
// (most customers are on Windows); its installer is honestly shown as
// "coming soon" until a Windows host builds and signs it — never a dead link.
export default function ForgeDownloadPage() {
  const release = getCaptureRelease(LATEST_CAPTURE_VERSION);
  const windowsAsset = release.assets.find(
    (asset) => asset.platform === "windows",
  );
  const linuxAssets = release.assets.filter(
    (asset) => asset.platform === "linux",
  );

  return (
    <main
      data-forge-capture-download-page
      className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
    >
      <div className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          FORGE desktop app
        </p>
        <h1 className="mt-2 text-3xl font-bold">Download FORGE Capture</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          Local-first screen capture: full monitor, window, region, and
          delayed captures with on-image markup. No account, no sign-in, no
          upload — captures stay on your machine unless you choose to save
          one to your FORGE library.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            Latest: {release.version}
          </span>
          <Link
            href={release.releaseUrl}
            className="text-xs font-medium text-sky-700 underline dark:text-sky-400"
          >
            Release notes
          </Link>
        </div>

        {/* Windows — first and primary. */}
        <section
          aria-labelledby="capture-download-windows"
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-4">
            <h2
              id="capture-download-windows"
              className="text-xl font-semibold"
            >
              Windows
            </h2>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              Coming soon
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            The Windows installer (per-user, no admin rights) is still being
            prepared — the current build is unsigned and for internal use
            only, so it is not published here until code signing lands.
            {windowsAsset
              ? ` The planned installer file is ${windowsAsset.filename}.`
              : ""}
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
            Requires Windows 10/11 (x64).
          </p>
        </section>

        {/* Linux — published now. */}
        <section
          aria-labelledby="capture-download-linux"
          className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 id="capture-download-linux" className="text-xl font-semibold">
              Linux
            </h2>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              {release.version} available
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            For Debian/Ubuntu (tested on Zorin OS). Install the .deb with
            <code className="mx-1 rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">
              sudo dpkg -i
            </code>
            or just run the AppImage.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {linuxAssets.map((asset) => (
              <Link
                key={asset.filename}
                href={`/forge/download/capture/${release.version}/${encodeURIComponent(asset.filename)}`}
                className="rounded-xl bg-sky-700 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-800"
              >
                {asset.label}
              </Link>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-500">
            {linuxAssets
              .map((asset) => asset.filename)
              .join(" · ")}
          </p>
        </section>

        <p className="mt-8 text-xs text-slate-500 dark:text-slate-500">
          Binaries are published as free GitHub Release assets and served
          through versioned download links, so the URL you save keeps working
          when the next version ships. Older versions remain available on
          the{" "}
          <Link
            href="https://github.com/onyxgolden/marketplace409/releases"
            className="underline"
          >
            releases page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
