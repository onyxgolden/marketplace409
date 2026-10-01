# AI Receipt Extraction — Gate Document (R26)

**Status: NOT CONNECTED.** The receipt/invoice scanner in the Rental Manager
ships its free layer only: upload to the file library, manual entry with
smart defaults, deterministic bill-matching, one-click apply through the
existing pay-vendors flow, and reconciliation assist. The "Scan with AI"
button is honest — it returns *"AI scan is not connected — enter details
manually"* and sends nothing anywhere.

## Why it's gated

AI extraction (vision/LLM reading a receipt image) costs per image and per
token. Under the build-spend motto — *free-to-build + can make money = build
now; costs money = shelved until the apps earn* — no paid AI API is wired,
no account is signed up, and no image ever leaves the machine for
extraction today. Turning it on needs Jason's explicit word.

## The two options, when Jason wants it

**Option A — local, free to run (recommended first look).** Jason's
iBUYPOWER box already runs Ollama (0.34.2) with Open WebUI. A
vision-capable local model (e.g. a Gemma 3 vision variant — Gemma 3 ships
vision support; exact model TBD at setup time) would read receipts on his
own hardware: no per-image cost, no data leaves the house. Caveats: needs a
vision model pulled and tested for accuracy (the 2026-09-23 flyer test
showed local models can invent details — extraction output must stay
human-verified before posting, same as the manual-entry flow), and it only
runs while that box is on.

**Option B — paid API.** A hosted vision model (OpenAI, Anthropic, Google —
vendor TBD at decision time). Costs per image plus per token; the exact
per-image price must be quoted and approved at setup time, never assumed.
Caveats: receipt images (vendor names, amounts, property info) leave the
machine — confirm that's acceptable; credentials go through the approved
secure flow, never chat or files.

## What Jason would approve, in order

1. **The option** — local Ollama vs paid API.
2. **The model** — exact model name and version, pinned.
3. **The cost** — per-image/per-token quote for the paid option (local = $0
   marginal, stated explicitly).
4. **Data boundary** — which receipt data may leave the machine (paid option),
   or confirmation it stays local.
5. **The switch** — an `AI_SCAN_ENABLED` env flag (default off) plus a kill
   switch in the UI; extraction results stay human-verified before they can
   post anything to the ledger.

## Technical seam (for the builders)

`src/application/rental/receiptExtraction.js` defines the contract:

- `extractReceiptData({ fileBytes, mimeType, fileName? })` → always an object
  with `status` (`not_connected` | `pending` | `complete` | `failed`),
  `provider`, `message`, and on success `vendorName`, `receiptDate`,
  `amountCents`, `taxCents`, `lineItems`, `rawJson`.
- `resolveExtractionProvider()` — today returns only the stub. A live
  provider is added here *after* the approvals above.
- `POST /api/rental/receipts/[id]/extract` — the route the UI calls; it
  never silently no-ops, it returns the stub's `not_connected` message.

Nothing in this slice performs a network call for extraction. The test suite
asserts the stub never touches the network (`receiptExtraction.test.js`).
