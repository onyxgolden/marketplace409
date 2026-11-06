// FORGE Doc-to-Overview — slice C: audio overview (narration script +
// offline text-to-speech synthesis).
//
// An audio artifact starts as a curator-reviewed SCRIPT. The script is
// derived from the approved explainer's own grounded assertions, so every
// spoken sentence is an admitted extract with a citation — nothing is
// paraphrased, nothing is invented. The script must be explicitly
// approved before any synthesis runs, and synthesis happens only with a
// locally installed OFFLINE text-to-speech engine. No network call, no
// paid API, no voice cloning, no impersonation, no copyrighted audio
// assets; the default voice is the engine's own original neutral voice.
//
// Honesty rule: when no offline TTS engine is installed in the runtime,
// the artifact stays a script-only draft and says so in plain words.
// A script-only draft is NEVER labeled completed audio, and no audio
// bytes are ever fabricated. The capability report records exactly
// which engines were looked for and which (if any) were found, so a
// reviewer can see what the runtime can and cannot do.

import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { escapeHtml } from "./sanitize.js";
import { isInstructionLike, sha256Hex } from "./generation.js";
import { MAX_AUDIO_BYTES, MAX_SCRIPT_CHARS, MAX_SCRIPT_SEGMENTS } from "./limits.js";

export const AUDIO_METHOD = "audio-script-local-v1";
export const MAX_TTS_TEXT_CHARS_PICO2WAVE = 8000;

// Offline TTS engines, in preference order. Each entry describes how to
// run the engine so it writes a local WAV file for a bounded script
// text. `maxTextChars` bounds the text the engine accepts in one call
// (pico2wave takes the text as a single argv value; the others read a
// file, so they take any bounded script). piper is deliberately NOT
// listed: without a downloaded voice model it cannot synthesize, and
// slice C does not download models.
const TTS_ENGINES = [
  {
    name: "espeak-ng",
    command: "espeak-ng",
    format: "wav",
    maxTextChars: Number.POSITIVE_INFINITY,
    argv: ({ textPath, outPath }) => ["-w", outPath, "-f", textPath],
  },
  {
    name: "espeak",
    command: "espeak",
    format: "wav",
    maxTextChars: Number.POSITIVE_INFINITY,
    argv: ({ textPath, outPath }) => ["-w", outPath, "-f", textPath],
  },
  {
    name: "flite",
    command: "flite",
    format: "wav",
    maxTextChars: Number.POSITIVE_INFINITY,
    argv: ({ textPath, outPath }) => ["-f", textPath, "-o", outPath],
  },
  {
    name: "pico2wave",
    command: "pico2wave",
    format: "wav",
    maxTextChars: MAX_TTS_TEXT_CHARS_PICO2WAVE,
    argv: ({ text, outPath }) => ["-w", outPath, "-l", "en-US", text],
  },
  {
    name: "festival",
    command: "festival",
    format: "wav",
    maxTextChars: Number.POSITIVE_INFINITY,
    argv: ({ schemePath }) => ["-b", schemePath],
  },
];

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects which offline TTS engines are actually installed in this
 * runtime. Pure filesystem scan of PATH — no subprocess, no network.
 * Pass `pathDirs` in tests to point at a fake PATH.
 *
 * Returns { available, engine, engines, checked, reason } where
 * `engine` is the first found engine (preference order) or null, and
 * `checked` lists every candidate with whether it was found.
 */
export function detectTtsCapability({ pathDirs } = {}) {
  const dirs = pathDirs ?? (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const checked = [];
  const engines = [];
  for (const candidate of TTS_ENGINES) {
    const foundDir = dirs.find((dir) => isExecutable(path.join(dir, candidate.command)));
    checked.push({ name: candidate.name, command: candidate.command, found: foundDir !== undefined });
    if (foundDir !== undefined) {
      engines.push({
        name: candidate.name,
        command: candidate.command,
        // The resolved absolute path — synthesis runs this, never a
        // bare command name, so a PATH lookup cannot be hijacked
        // between detection and synthesis.
        path: path.join(foundDir, candidate.command),
        format: candidate.format,
        maxTextChars: candidate.maxTextChars,
      });
    }
  }
  const engine = engines[0] ?? null;
  return {
    available: engine !== null,
    engine,
    engines,
    checked,
    reason: engine
      ? `Offline TTS available: ${engine.name}.`
      : "No offline text-to-speech engine is installed in this runtime.",
  };
}

function describeEngine(engine) {
  return TTS_ENGINES.find((candidate) => candidate.name === engine.name);
}

function escapeFestivalString(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, " ");
}

/**
 * Validates a WAV buffer and reads its duration from the RIFF header.
 * Returns { valid, durationSeconds, reason } — durationSeconds is null
 * when the file is a well-formed WAV whose header carries no byte rate.
 */
export function inspectWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    return { valid: false, durationSeconds: null, reason: "Audio output is too short to be a WAV file." };
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return { valid: false, durationSeconds: null, reason: "Audio output is not a WAV file (missing RIFF/WAVE header)." };
  }
  let offset = 12;
  let byteRate = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (id === "data") {
      dataSize = size;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataSize === null) {
    return { valid: false, durationSeconds: null, reason: "WAV file has no data chunk." };
  }
  if (!byteRate || byteRate <= 0) {
    return { valid: true, durationSeconds: null, reason: null };
  }
  return { valid: true, durationSeconds: dataSize / byteRate, reason: null };
}

function defaultRunCommand(command, argv, { timeoutMs = 120000 } = {}) {
  return spawnSync(command, argv, { timeout: timeoutMs, encoding: "buffer", maxBuffer: MAX_AUDIO_BYTES });
}

/**
 * Synthesizes a WAV for a script text with a detected offline engine.
 * `capability` is the detectTtsCapability() report; the first engine
 * that can take the text is used. `runCommand` is injectable for tests
 * (signature (command, argv) => { status, stdout, stderr }).
 *
 * Never fabricates audio: a failed run, a missing output file, or an
 * output that is not a valid WAV returns ok:false with a named code.
 */
export function synthesizeAudio({ scriptText, capability, runCommand = defaultRunCommand } = {}) {
  const text = typeof scriptText === "string" ? scriptText : "";
  if (text.length === 0) {
    return { ok: false, error: { code: "TTS_EMPTY_SCRIPT", message: "Cannot synthesize audio for an empty script." } };
  }
  if (text.length > MAX_SCRIPT_CHARS) {
    return { ok: false, error: { code: "TTS_TEXT_TOO_LONG", message: `Script text (${text.length} chars) exceeds the ${MAX_SCRIPT_CHARS}-char synthesis limit.` } };
  }
  const engines = capability?.engines ?? (capability?.engine ? [capability.engine] : []);
  const engine = engines.find((candidate) => text.length <= candidate.maxTextChars);
  if (!engine) {
    return {
      ok: false,
      error: {
        code: "TTS_UNAVAILABLE",
        message: "No offline text-to-speech engine is available for this script in this runtime.",
      },
    };
  }
  const descriptor = describeEngine(engine);
  if (!descriptor) {
    return { ok: false, error: { code: "TTS_ENGINE_UNKNOWN", message: `Unknown TTS engine: ${engine.name}.` } };
  }

  const workDir = mkdtempSync(path.join(tmpdir(), "doc-overview-tts-"));
  try {
    const textPath = path.join(workDir, "script.txt");
    const outPath = path.join(workDir, "overview.wav");
    writeFileSync(textPath, text, "utf8");
    let argv;
    if (engine.name === "festival") {
      const schemePath = path.join(workDir, "synth.scm");
      const scheme = `(begin (voice_kal_diphone) (utt.save.wave (SayText "${escapeFestivalString(text)}") "${outPath}"))`;
      writeFileSync(schemePath, scheme, "utf8");
      argv = descriptor.argv({ schemePath });
    } else if (engine.name === "pico2wave") {
      argv = descriptor.argv({ text, outPath });
    } else {
      argv = descriptor.argv({ textPath, outPath });
    }
    const result = runCommand(engine.path ?? engine.command, argv);
    if (result?.error) {
      return { ok: false, error: { code: "TTS_SYNTHESIS_FAILED", message: `Offline TTS engine ${engine.name} failed to start: ${result.error.message}` } };
    }
    if (typeof result?.status === "number" && result.status !== 0) {
      const detail = result.stderr ? Buffer.from(result.stderr).toString("utf8").slice(0, 500) : "";
      return { ok: false, error: { code: "TTS_SYNTHESIS_FAILED", message: `Offline TTS engine ${engine.name} exited with code ${result.status}.${detail ? ` ${detail}` : ""}` } };
    }
    if (!existsSync(outPath)) {
      return { ok: false, error: { code: "TTS_OUTPUT_MISSING", message: `Offline TTS engine ${engine.name} finished but wrote no audio file.` } };
    }
    const audio = readFileSync(outPath);
    if (audio.length > MAX_AUDIO_BYTES) {
      return { ok: false, error: { code: "TTS_OUTPUT_TOO_LARGE", message: `Synthesized audio (${audio.length} bytes) exceeds the ${MAX_AUDIO_BYTES}-byte limit.` } };
    }
    const inspected = inspectWav(audio);
    if (!inspected.valid) {
      return { ok: false, error: { code: "TTS_OUTPUT_INVALID", message: inspected.reason } };
    }
    return {
      ok: true,
      audio,
      format: "wav",
      engine: engine.name,
      durationSeconds: inspected.durationSeconds,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Builds the narration script for an audio draft from an explainer's
 * own grounded assertions (summary, then key concepts, then context),
 * in that order. Each segment is one explainer assertion, verbatim,
 * with its citations — the script is grounded by construction.
 * Instruction-like sentences are never spoken (they cannot be in the
 * explainer either, but the check is repeated here so a hand-edited
 * explainer cannot smuggle one into narration).
 */
export function buildNarrationScript({ explainerContent, manifest }) {
  const assertions = [
    ...(explainerContent.summary ?? []),
    ...(explainerContent.keyConcepts ?? []).flatMap((concept) => concept.assertions ?? []),
    ...(explainerContent.context ?? []),
  ];
  const segments = [];
  let truncated = false;
  let runningChars = 0;
  for (const assertion of assertions) {
    if (segments.length >= MAX_SCRIPT_SEGMENTS) {
      truncated = true;
      break;
    }
    if (!assertion || typeof assertion.text !== "string" || assertion.text.length === 0) continue;
    if (isInstructionLike(assertion.text)) continue;
    const citations = Array.isArray(assertion.citations) ? assertion.citations : [];
    if (citations.length === 0) continue;
    const extra = segments.length === 0 ? assertion.text.length : assertion.text.length + 1;
    if (runningChars + extra > MAX_SCRIPT_CHARS) {
      truncated = true;
      break;
    }
    runningChars += extra;
    segments.push({
      id: `seg-${segments.length + 1}`,
      text: assertion.text,
      citations,
    });
  }
  const needsReview = [...(explainerContent.needsReview ?? [])];
  if (truncated) {
    needsReview.push({
      code: "SCRIPT_TRUNCATED",
      message: "The narration script was cut short at the script length limit — some grounded material was not spoken.",
    });
  }
  // References cover exactly the passages the segments cite (keyed by
  // passage, quote included) — the explainer's full reference list
  // may cite glossary passages the script never speaks, and those
  // must not be listed here.
  const seen = new Set();
  const references = [];
  for (const segment of segments) {
    for (const citation of segment.citations) {
      const key = `${citation.documentId}|${JSON.stringify(citation.locator)}|${citation.checksum}|${citation.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(citation);
    }
  }
  return {
    kind: "audio",
    title: explainerContent.title,
    method: AUDIO_METHOD,
    sourceSetHash: manifest.sourceSetHash,
    segments,
    references,
    excludedSentences: explainerContent.excludedSentences ?? [],
    needsReview,
  };
}

/** Plain narration text for synthesis: title, then segments in order. */
export function audioScriptText(script) {
  const parts = [script.title, ...script.segments.map((segment) => segment.text)];
  return parts.filter(Boolean).join(" ");
}

/**
 * Audits an audio script the same way slice B audits explainers (see
 * auditCitations in generation.js, same shapes): every segment must
 * carry at least one citation that resolves to an admitted passage,
 * and the segment text must equal one of its citations' quotes
 * verbatim — reworded words cannot ride on a citation. References
 * must exactly cover the citations used (key includes the quote:
 * several passages share one document+locator). `extracts` is the
 * array form [{ documentId, locator, text, checksum }]; `citationIndex`
 * is the recorded reference list used for edits, where live extracts
 * are not re-supplied.
 */
export function auditAudioScript({ script, manifest, extracts, citationIndex }) {
  const issues = [];
  const manifestDocs = new Map((manifest?.documents ?? []).map((doc) => [doc.documentId, doc]));
  const extractByKey = new Map();
  for (const extract of extracts ?? []) {
    extractByKey.set(`${extract.documentId}|${JSON.stringify(extract.locator)}`, extract);
  }
  const indexByKey = new Map();
  for (const citation of citationIndex ?? []) {
    const key = `${citation.documentId}|${JSON.stringify(citation.locator)}`;
    if (!indexByKey.has(key)) indexByKey.set(key, []);
    indexByKey.get(key).push(citation);
  }

  const checkCitation = (citation, where) => {
    if (!citation || typeof citation.documentId !== "string") {
      issues.push({ code: "INVALID_CITATION", message: `${where}: citation is missing a documentId.` });
      return;
    }
    if (manifest && !manifestDocs.has(citation.documentId)) {
      issues.push({ code: "INVALID_CITATION", message: `${where}: citation names document ${citation.documentId}, which is not in the source set.` });
      return;
    }
    const key = `${citation.documentId}|${JSON.stringify(citation.locator)}`;
    if (citationIndex) {
      const recordedAtLocator = indexByKey.get(key);
      if (!recordedAtLocator || recordedAtLocator.length === 0) {
        issues.push({ code: "LOCATOR_MISMATCH", message: `${where}: citation locator does not match any passage admitted for ${citation.documentId}.` });
        return;
      }
      const recorded = recordedAtLocator.find((entry) => entry.quote === citation.quote);
      if (!recorded) {
        issues.push({ code: "QUOTE_MISMATCH", message: `${where}: quoted text does not match any admitted passage at that locator for ${citation.documentId}.` });
        return;
      }
      if (recorded.checksum !== citation.checksum) {
        issues.push({ code: "CHECKSUM_MISMATCH", message: `${where}: citation checksum does not match the admitted passage for ${citation.documentId}.` });
      }
      return;
    }
    const extract = extractByKey.get(key);
    if (!extract) {
      issues.push({ code: "LOCATOR_MISMATCH", message: `${where}: citation locator does not match any admitted extract for ${citation.documentId}.` });
      return;
    }
    if (extract.checksum !== citation.checksum) {
      issues.push({ code: "CHECKSUM_MISMATCH", message: `${where}: citation checksum does not match the admitted extract for ${citation.documentId}.` });
    }
    if (typeof citation.quote === "string" && citation.quote.length > 0 && !extract.text.includes(citation.quote)) {
      issues.push({ code: "QUOTE_MISMATCH", message: `${where}: quoted text does not appear verbatim in the admitted extract for ${citation.documentId}.` });
    }
  };

  const usedKeys = new Set();
  (script.segments ?? []).forEach((segment, index) => {
    const where = `segment ${index + 1}`;
    if (!segment || typeof segment.text !== "string" || segment.text.length === 0) {
      issues.push({ code: "SEGMENT_EMPTY", message: `${where} has no text.` });
      return;
    }
    const citations = Array.isArray(segment.citations) ? segment.citations : [];
    if (citations.length === 0) {
      issues.push({ code: "SEGMENT_UNSOURCED", message: `${where} "${segment.text.slice(0, 80)}" has no citation.` });
      return;
    }
    const quotes = citations.map((citation) => citation?.quote).filter((quote) => typeof quote === "string");
    if (!quotes.includes(segment.text)) {
      issues.push({ code: "QUOTE_MISMATCH", message: `${where}: segment text does not match any of its quoted source passages; reworded words cannot ride on a citation.` });
    }
    for (const citation of citations) {
      usedKeys.add(`${citation.documentId}|${JSON.stringify(citation.locator)}|${citation.checksum}|${citation.quote}`);
      checkCitation(citation, where);
    }
  });
  for (const reference of script.references ?? []) {
    const key = `${reference.documentId}|${JSON.stringify(reference.locator)}|${reference.checksum}|${reference.quote}`;
    if (!usedKeys.has(key)) {
      issues.push({ code: "UNUSED_REFERENCE", message: `Reference to ${reference.documentId} is listed but no segment cites it.` });
    }
  }
  for (const key of usedKeys) {
    const listed = (script.references ?? []).some(
      (ref) => `${ref.documentId}|${JSON.stringify(ref.locator)}|${ref.checksum}|${ref.quote}` === key,
    );
    if (!listed) {
      issues.push({ code: "MISSING_REFERENCE", message: "A segment cites a passage that is not listed in References." });
      break;
    }
  }
  if (manifest && script.sourceSetHash != null && script.sourceSetHash !== manifest.sourceSetHash) {
    issues.push({ code: "SOURCE_SET_CHANGED", message: "Script was generated on a different source-set hash than the current manifest." });
  }
  if (script.sourceSetHash == null) {
    issues.push({ code: "MISSING_SOURCE_HASH", message: "Script carries no source-set hash." });
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Chapter timestamps from a synthesized duration: each segment's share
 * of the runtime is proportional to its word count. Returns
 * [{ segmentId, startsAtSeconds }] — empty when no duration is known.
 */
export function computeChapters({ segments, durationSeconds }) {
  if (!durationSeconds || durationSeconds <= 0) return [];
  const counts = (segments ?? []).map((segment) => segment.text.split(/\s+/).filter(Boolean).length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return [];
  let cursor = 0;
  return (segments ?? []).map((segment, index) => {
    const startsAtSeconds = Math.round(cursor * 100) / 100;
    cursor += (counts[index] / total) * durationSeconds;
    return { segmentId: segment.id, startsAtSeconds };
  });
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function statusHeading(content, status) {
  return status === "approved" || status === "kept"
    ? `Approved audio overview: ${content.title}`
    : `Draft audio overview: ${content.title}`;
}

/**
 * Transcript (Markdown) for an audio artifact. Status-aware: an
 * approved/kept export never carries draft labeling, and a script-only
 * artifact says so in plain words — it never claims audio exists.
 */
export function renderAudioTranscript(content, { status } = {}) {
  const lines = [];
  lines.push(`# ${statusHeading(content, status)}`, "");
  if (content.audio?.present) {
    lines.push(
      `Audio synthesized locally with ${content.audio.engine} (offline text-to-speech, no network call).`,
      `Format: WAV, ${content.audio.bytes} bytes${content.audio.durationSeconds != null ? `, ${content.audio.durationSeconds.toFixed(1)} seconds` : ""}.`,
      "",
    );
  } else {
    lines.push(
      "Script only — no audio was synthesized.",
      "No offline text-to-speech engine was available in this runtime, so this artifact is the reviewed script, not a completed audio overview.",
      "",
    );
  }
  lines.push("## Script", "");
  content.segments.forEach((segment, index) => {
    const numbers = segment.citations.map((citation) => {
      const refIndex = content.references.findIndex(
        (ref) => ref.documentId === citation.documentId && ref.locator === citation.locator,
      );
      return refIndex >= 0 ? refIndex + 1 : "?";
    });
    lines.push(`${index + 1}. ${segment.text} [${numbers.join(", ")}]`);
  });
  lines.push("");
  if (content.audio?.present && content.chapters?.length > 0) {
    lines.push("## Chapters", "");
    content.chapters.forEach((chapter, index) => {
      lines.push(`- ${formatTimestamp(chapter.startsAtSeconds)} — Segment ${index + 1}`);
    });
    lines.push("");
  }
  lines.push("## Sources", "");
  content.references.forEach((ref, index) => {
    lines.push(`${index + 1}. ${ref.documentId} — ${ref.locator}`);
  });
  lines.push("", "## Manifest", "");
  lines.push(`- Method: ${content.method}`);
  lines.push(`- Source set: ${content.sourceSetHash}`);
  lines.push(`- Content hash: ${content.contentHash ?? sha256Hex(JSON.stringify(content))}`);
  lines.push(`- Script status: ${content.scriptStatus ?? "draft"}`);
  if (content.audio?.present) {
    lines.push(`- Audio SHA-256: ${content.audio.sha256}`);
  }
  if (content.needsReview?.length > 0) {
    lines.push("", "## Review notes", "");
    content.needsReview.forEach((item) => lines.push(`- ${item.code}: ${item.message}`));
  }
  return lines.join("\n");
}

/**
 * Preview HTML for an audio artifact. Server-rendered; every piece of
 * source-derived text is escaped. The audio player streams from the
 * owner-bound audio route — no audio bytes are embedded in the page.
 */
export function renderAudioHtml(content, { artifactId, watermark = true, stale = false } = {}) {
  const parts = [];
  if (watermark) {
    parts.push(`<p><strong>DRAFT — NOT VERIFIED</strong> — this audio overview is a draft until a curator reviews it.</p>`);
  }
  if (stale) {
    parts.push(`<p><strong>STALE</strong> — a source changed since this draft was generated. Regenerate and re-review before use.</p>`);
  }
  parts.push(`<h2>${escapeHtml(content.title)}</h2>`);
  if (content.audio?.present) {
    parts.push(
      `<p>Audio synthesized locally with ${escapeHtml(content.audio.engine)} (offline text-to-speech). ` +
        `WAV, ${escapeHtml(String(content.audio.bytes))} bytes` +
        (content.audio.durationSeconds != null ? `, ${escapeHtml(content.audio.durationSeconds.toFixed(1))} seconds` : "") +
        `.</p>`,
    );
    if (artifactId) {
      parts.push(
        `<audio controls src="/api/doc-overview/artifacts/${escapeHtml(artifactId)}/audio">` +
          `Your browser cannot play the audio preview.</audio>`,
      );
    }
  } else {
    parts.push(
      `<p><strong>Script only — no audio was synthesized.</strong> ` +
        `No offline text-to-speech engine was available in this runtime, so this artifact is the reviewed script, ` +
        `not a completed audio overview.</p>`,
    );
  }
  parts.push(`<p>Script status: <strong>${escapeHtml(content.scriptStatus ?? "draft")}</strong></p>`);
  parts.push(`<h3>Script</h3><ol>`);
  content.segments.forEach((segment) => {
    const numbers = segment.citations.map((citation) => {
      const refIndex = content.references.findIndex(
        (ref) => ref.documentId === citation.documentId && ref.locator === citation.locator,
      );
      return refIndex >= 0 ? refIndex + 1 : "?";
    });
    parts.push(`<li>${escapeHtml(segment.text)} <sup>[${numbers.join(", ")}]</sup></li>`);
  });
  parts.push(`</ol>`);
  if (content.audio?.present && content.chapters?.length > 0) {
    parts.push(`<h3>Chapters</h3><ul>`);
    content.chapters.forEach((chapter, index) => {
      parts.push(`<li>${escapeHtml(formatTimestamp(chapter.startsAtSeconds))} — Segment ${index + 1}</li>`);
    });
    parts.push(`</ul>`);
  }
  if (content.needsReview?.length > 0) {
    parts.push(`<h3>Review notes</h3><ul>`);
    content.needsReview.forEach((item) => {
      parts.push(`<li><strong>${escapeHtml(item.code)}</strong>: ${escapeHtml(item.message)}</li>`);
    });
    parts.push(`</ul>`);
  }
  parts.push(`<h3>Sources</h3><ol>`);
  content.references.forEach((ref) => {
    parts.push(`<li>${escapeHtml(ref.documentId)} — ${escapeHtml(ref.locator)}</li>`);
  });
  parts.push(`</ol>`);
  return parts.join("\n");
}
