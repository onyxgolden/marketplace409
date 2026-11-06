// FORGE Doc-to-Overview — slice A policy limits.
//
// Slice A (curated input + artifact contract) bounds every input before
// extraction or storage. These limits are policy, not tuning knobs: a
// document over a limit is rejected with a named reason, never silently
// truncated, so a curator always knows why a source did not get in.
// See the slice brief in forge-ai-drop:
// `results/chatgpt/doc-to-overview-scope-2026-11-04.md`.

export const MAX_DOCUMENTS_PER_SET = 10;
export const MAX_DOCUMENT_CHARS = 1_000_000;
export const MAX_DOCUMENT_PAGES = 500;
export const MAX_TOTAL_CHARS = 2_000_000;
export const MAX_EXTRACTS_PER_DOCUMENT = 200;
export const MAX_EXTRACT_CHARS = 500_000;
export const MAX_TITLE_CHARS = 300;
export const MAX_NAME_CHARS = 200;
export const MAX_PURPOSE_CHARS = 1000;
export const MAX_NOTE_CHARS = 2000;
export const MAX_SECTION_NAME_CHARS = 300;
export const MAX_BASIS_CHARS = 500;

// Slice B (written explainer + infographic) policy limits. Generation is
// extractive and local-only: sentences are selected from admitted
// extracts, never invented, so these bounds cap selection, not model
// output. A draft that cannot ground enough material records NEEDS
// REVIEW instead of fabricating findings.
export const MAX_FINDINGS_PER_INFOGRAPHIC = 7;
export const MIN_FINDINGS_PER_INFOGRAPHIC = 3;
export const MAX_FINDING_CHARS = 240;
export const MIN_FINDING_CHARS = 40;
export const MAX_SUMMARY_SENTENCES = 4;
export const MAX_CONCEPTS = 8;
export const MAX_CONTEXT_SENTENCES = 10;
export const MAX_EXPLAINER_SENTENCES = 40;
export const MAX_GLOSSARY_ENTRIES = 12;
export const MAX_CONTENT_CHARS = 200_000;
export const MAX_EDIT_CHARS = 50_000;
