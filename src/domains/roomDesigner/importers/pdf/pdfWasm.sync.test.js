// The PDF importer serves pdf.js's image decoders from public/pdfjs/wasm/
// (see its README). They must be byte-identical to the installed
// pdfjs-dist, or a pdf.js upgrade would pair a new worker with old decoders.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../../..");
const PUBLIC_DIR = path.join(ROOT, "public/pdfjs/wasm");
const PKG_DIR = path.join(ROOT, "node_modules/pdfjs-dist/wasm");
const sha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

describe("vendored pdf.js decoders", () => {
  const files = fs.readdirSync(PUBLIC_DIR).filter((f) => f !== "README.md");

  it("ships the decoders scanned plans need, with their licences", () => {
    for (const f of ["jbig2.wasm", "jbig2_nowasm_fallback.js", "openjpeg.wasm", "openjpeg_nowasm_fallback.js", "qcms_bg.wasm"]) {
      expect(files).toContain(f);
    }
    expect(files.filter((f) => f.startsWith("LICENSE_")).length).toBe(6);
  });

  it("matches the installed pdfjs-dist byte for byte (re-copy after upgrading pdf.js; see README)", () => {
    for (const f of files) expect(sha(path.join(PUBLIC_DIR, f)), f).toBe(sha(path.join(PKG_DIR, f)));
  });
});
