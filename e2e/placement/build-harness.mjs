// Builds the Slice-7 confirmation-placement Playwright harness:
// esbuild bundles for the readiness panel + the package detail page,
// Tailwind CSS from src/app/globals.css, and the static HTML + mock
// copied into e2e/placement/dist/. Run directly (`node
// e2e/placement/build-harness.mjs`); the placement spec runs it in
// beforeAll so every run tests the current source.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const placementDir = path.join(repoRoot, "e2e", "placement");
const distDir = path.join(placementDir, "dist");

mkdirSync(distDir, { recursive: true });

const esbuildArgs = (entry, outfile) => [
  "--no-install",
  "esbuild",
  entry,
  "--bundle",
  "--format=iife",
  "--jsx=automatic",
  "--loader:.js=jsx",
  "--loader:.jsx=jsx",
  "--alias:@=./src",
  "--alias:next/link=./e2e/placement/stubs/next-link.jsx",
  "--alias:next/navigation=./e2e/placement/stubs/next-navigation.js",
  "--define:process.env.NODE_ENV=\"production\"",
  `--outfile=${outfile}`,
];

for (const [entry, outfile] of [
  ["e2e/placement/harness/readiness-entry.jsx", "e2e/placement/dist/readiness.js"],
  ["e2e/placement/harness/detail-entry.jsx", "e2e/placement/dist/detail.js"],
]) {
  execFileSync("npx", esbuildArgs(entry, outfile), { cwd: repoRoot, stdio: "inherit" });
}

// Tailwind v4 via the PostCSS API (no postcss-cli binary in this repo).
const postcss = (await import("postcss")).default;
const tailwindcss = (await import("@tailwindcss/postcss")).default;
const cssInput = readFileSync(path.join(repoRoot, "src/app/globals.css"), "utf8");
const cssResult = await postcss([tailwindcss()]).process(cssInput, {
  from: path.join(repoRoot, "src/app/globals.css"),
  to: path.join(distDir, "tailwind.css"),
});
writeFileSync(path.join(distDir, "tailwind.css"), cssResult.css);

cpSync(path.join(placementDir, "harness", "readiness.html"), path.join(distDir, "readiness.html"));
cpSync(path.join(placementDir, "harness", "detail.html"), path.join(distDir, "detail.html"));
cpSync(path.join(placementDir, "mock.js"), path.join(distDir, "mock.js"));

console.log("placement harness built in e2e/placement/dist/");
