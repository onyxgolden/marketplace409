# pdf.js image decoders (vendored)

These are copied unchanged from `pdfjs-dist@5.7.284/wasm/` and served as static files so the PDF importer can decode scanned pages. pdf.js loads them only when a page needs them (`getDocument({ wasmUrl })`):

| File | Decodes |
|---|---|
| `jbig2.wasm`, `jbig2_nowasm_fallback.js` | JBIG2 and CCITT fax images: 1-bit scans, the usual encoding for scanned plan sheets |
| `openjpeg.wasm`, `openjpeg_nowasm_fallback.js` | JPEG 2000 images |
| `qcms_bg.wasm` | ICC colour profiles |

- `quickjs-eval.*` (PDF scripting) is deliberately left out.
- Licences are the `LICENSE_*` files next to each decoder: Apache-2.0 (pdf.js JBIG2 wrapper), BSD (PDFium JBIG2, OpenJPEG, the pdf.js OpenJPEG/QCMS wrappers) and MIT (qcms).
- `pdfWasm.sync.test.js` fails if these copies drift from the installed `pdfjs-dist`. After upgrading pdf.js, re-copy them:
  `for f in $(ls public/pdfjs/wasm | grep -v README); do cp node_modules/pdfjs-dist/wasm/$f public/pdfjs/wasm/; done`
