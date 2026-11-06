// FORGE Doc-to-Overview — slice C: audio review-flow tests.
//
// Full lifecycle over the real filesystem store: generate (script
// only) → approve-script → synthesize → submit → approve → export,
// plus the honest no-TTS fallback, the script-approval gate, edit
// resetting approval + audio, stale refusal, and cross-owner 404.
//
// TTS is injected through options.tts (a stub engine returning a
// real minimal WAV) — the real subprocess path is covered in the
// domain tests; here the orchestration is under test.

import { mkdtempSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDraftStore } from "./draftStore.js";
import { pickSources } from "./picker.js";
import { computeSourceSetHash } from "@/domains/doc-overview/sourceSets.js";
import { inspectWav } from "@/domains/doc-overview/audio.js";
import {
  exportArtifact,
  generateDrafts,
  getArtifactAudio,
  getArtifactPreview,
  reviewArtifact,
} from "./generate.js";

const DOC_A_TEXT = [
  "# Photosynthesis",
  "",
  "## Overview",
  "",
  "Photosynthesis is the process by which green plants convert sunlight, water, and carbon dioxide into oxygen and glucose. This process takes place primarily in the leaves of plants, inside organelles called chloroplasts.",
  "",
  "## Process",
  "",
  "The light-dependent reactions occur in the thylakoid membranes of the chloroplast. The Calvin cycle then fixes carbon dioxide into sugar molecules using energy captured from sunlight.",
  "",
].join("\n");

const DOC_B_TEXT = [
  "# Cellular Respiration",
  "",
  "## Overview",
  "",
  "Cellular respiration is the process by which cells break down glucose to release energy in the form of ATP. This process occurs in the mitochondria of eukaryotic cells.",
  "",
  "## Stages",
  "",
  "Glycolysis takes place in the cytoplasm and splits one glucose molecule into two pyruvate molecules. The electron transport chain generates most of the ATP.",
  "",
].join("\n");

/** Minimal PCM WAV: 8000 Hz mono 16-bit, byteRate 16000, 1.0s of data. */
function makeWav(dataSize = 16000) {
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const FAKE_CAPABILITY = {
  available: true,
  engine: { name: "espeak-ng", command: "espeak-ng", format: "wav", maxTextChars: Number.POSITIVE_INFINITY },
  engines: [{ name: "espeak-ng", command: "espeak-ng", format: "wav", maxTextChars: Number.POSITIVE_INFINITY }],
  checked: [{ name: "espeak-ng", command: "espeak-ng", found: true }],
  reason: "Offline TTS available: espeak-ng.",
};

const NO_TTS_CAPABILITY = {
  available: false,
  engine: null,
  engines: [],
  checked: [
    { name: "espeak-ng", command: "espeak-ng", found: false },
    { name: "espeak", command: "espeak", found: false },
    { name: "flite", command: "flite", found: false },
    { name: "pico2wave", command: "pico2wave", found: false },
    { name: "festival", command: "festival", found: false },
  ],
  reason: "No offline text-to-speech engine is installed in this runtime.",
};

function fakeTts() {
  return {
    detectTtsCapability: () => FAKE_CAPABILITY,
    synthesizeAudio: ({ scriptText }) => {
      if (!scriptText || scriptText.length === 0) {
        return { ok: false, error: { code: "TTS_EMPTY_SCRIPT", message: "empty script" } };
      }
      const audio = makeWav();
      return { ok: true, audio, format: "wav", engine: "espeak-ng", durationSeconds: 1 };
    },
  };
}

function noTts() {
  return {
    detectTtsCapability: () => NO_TTS_CAPABILITY,
    synthesizeAudio: () => ({
      ok: false,
      error: { code: "TTS_UNAVAILABLE", message: "No offline text-to-speech engine is available for this script in this runtime." },
    }),
  };
}

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), "doc-overview-audio-flow-"));
}

function setup(tts) {
  const root = tempRoot();
  const store = createDraftStore(root, { ownerId: "owner-1" });
  const picked = pickSources({
    name: "Energy in living cells",
    ownerId: "owner-1",
    curator: { id: "curator-1", displayName: "Curator" },
    purpose: "Test fixture",
    documents: [
      {
        documentId: "doc_a", title: "Photosynthesis", sourceType: "forge-reference",
        text: DOC_A_TEXT, ranges: [{ type: "section", name: "Overview" }, { type: "section", name: "Process" }],
        permissionGranted: true, permissionBasis: "test fixture",
      },
      {
        documentId: "doc_b", title: "Cellular Respiration", sourceType: "forge-reference",
        text: DOC_B_TEXT, ranges: [{ type: "section", name: "Overview" }, { type: "section", name: "Stages" }],
        permissionGranted: true, permissionBasis: "test fixture",
      },
    ],
  });
  if (!picked.ok) throw new Error(`fixture pick failed: ${JSON.stringify(picked.rejections)}`);
  store.saveSourceSet(picked.manifest);
  const texts = { doc_a: { text: DOC_A_TEXT }, doc_b: { text: DOC_B_TEXT } };
  const result = generateDrafts(
    { store, manifestId: picked.manifest.id, documents: texts, curator: "curator-1" },
    { tts },
  );
  if (!result.ok) throw new Error(`fixture generate failed: ${JSON.stringify(result.error)}`);
  const audio = result.artifacts.find((artifact) => artifact.type === "audio");
  return { root, store, manifest: picked.manifest, texts, audio };
}

function approveScript(store, artifactId, actor = "curator-1") {
  const result = reviewArtifact({ store, artifactId, action: "approve-script", actor });
  expect(result.ok).toBe(true);
  return result;
}

function synthesize(store, artifactId, tts, actor = "curator-1") {
  return reviewArtifact({ store, artifactId, action: "synthesize", actor }, { tts });
}

describe("audio flow with an offline TTS engine", () => {
  it("runs script approval → synthesis → approve → WAV export, with chapters and a player", () => {
    const tts = fakeTts();
    const { root, store, audio } = setup(tts);
    const actor = "curator-1";

    // Synthesis is gated on explicit script approval — never automatic.
    const early = synthesize(store, audio.id, tts);
    expect(early.ok).toBe(false);
    expect(early.error.code).toBe("SCRIPT_NOT_APPROVED");
    expect(store.getDraft(audio.id).content.audio).toBeNull();

    // approve-script does not change the artifact status, only the
    // script gate — and it records the actor.
    const approvedScript = approveScript(store, audio.id, actor);
    expect(approvedScript.artifact.status).toBe("draft");
    const draft = store.getDraft(audio.id);
    expect(draft.content.scriptStatus).toBe("approved");
    expect(draft.content.scriptApprovedBy).toBe(actor);
    expect(draft.reviewHistory.map((entry) => entry.action)).toContain("approve-script");

    // Synthesis stores real WAV bytes as a sidecar, with chapters
    // and a manifest-grade audio record — and clears the TTS note.
    const synthesized = synthesize(store, audio.id, tts);
    expect(synthesized.ok).toBe(true);
    const withAudio = store.getDraft(audio.id);
    expect(withAudio.content.audio.present).toBe(true);
    expect(withAudio.content.audio.format).toBe("wav");
    expect(withAudio.content.audio.engine).toBe("espeak-ng");
    expect(withAudio.content.audio.bytes).toBe(16044);
    expect(withAudio.content.audio.durationSeconds).toBe(1);
    expect(withAudio.content.audio.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(withAudio.content.chapters).toHaveLength(withAudio.content.segments.length);
    expect(withAudio.content.chapters[0].startsAtSeconds).toBe(0);
    expect(withAudio.content.needsReview.map((item) => item.code)).not.toContain("TTS_UNAVAILABLE");
    const audioRecord = store.getDraft(audio.id).content.audio;
    expect(store.getAudio(audio.id, audioRecord)).toEqual(makeWav());
    expect(inspectWav(store.getAudio(audio.id, audioRecord)).valid).toBe(true);

    // Preview carries a player; the audio route serves the bytes.
    const preview = getArtifactPreview({ store, artifactId: audio.id });
    expect(preview.ok).toBe(true);
    expect(preview.html).toContain("<audio controls");
    expect(preview.html).toContain(`/api/doc-overview/artifacts/${audio.id}/audio`);
    const served = getArtifactAudio({ store, artifactId: audio.id });
    expect(served.ok).toBe(true);
    expect(served.mimeType).toBe("audio/wav");
    expect(served.content).toEqual(makeWav());

    // Approve, then export the playable WAV — no draft labeling.
    reviewArtifact({ store, artifactId: audio.id, action: "submit", actor });
    reviewArtifact({ store, artifactId: audio.id, action: "approve", actor });
    const exported = exportArtifact({ store, artifactId: audio.id });
    expect(exported.ok).toBe(true);
    expect(exported.filename).toBe(`${audio.id}.wav`);
    expect(exported.mimeType).toBe("audio/wav");
    expect(inspectWav(exported.content).valid).toBe(true);

    // Reload preserves the audio record and the sidecar.
    const second = createDraftStore(root, { ownerId: "owner-1" });
    expect(second.getDraft(audio.id).content.audio.present).toBe(true);
    expect(second.getAudio(audio.id, second.getDraft(audio.id).content.audio)).toEqual(makeWav());
  });

  it("an edit after synthesis resets script approval and drops the stale recording", () => {
    const tts = fakeTts();
    const { store, audio } = setup(tts);
    const actor = "curator-1";
    approveScript(store, audio.id, actor);
    expect(synthesize(store, audio.id, tts).ok).toBe(true);
    const recorded = store.getDraft(audio.id).content.audio;
    expect(store.getAudio(audio.id, recorded)).not.toBeNull();

    const draft = store.getDraft(audio.id);
    const edited = reviewArtifact({
      store,
      artifactId: audio.id,
      action: "edit",
      actor,
      editedContent: {
        kind: "audio",
        segments: draft.content.segments.slice(0, 1),
      },
    });
    expect(edited.ok).toBe(true);
    const stored = store.getDraft(audio.id);
    expect(stored.content.scriptStatus).toBe("draft");
    expect(stored.content.scriptApprovedBy).toBeNull();
    expect(stored.content.audio).toBeNull();
    expect(stored.content.chapters).toEqual([]);
    // The old recording is gone with the old record: the sidecar the
    // old record referenced no longer exists under its hash.
    expect(store.getAudio(audio.id, recorded)).toBeNull();
    // The edited script must be re-approved before synthesis runs again.
    expect(synthesize(store, audio.id, tts).error.code).toBe("SCRIPT_NOT_APPROVED");
  });

  it("an edit that rewords a segment is refused by the script audit", () => {
    const { store, audio } = setup(fakeTts());
    const draft = store.getDraft(audio.id);
    const citation = draft.content.segments[0].citations[0];
    const result = reviewArtifact({
      store,
      artifactId: audio.id,
      action: "edit",
      actor: "curator-1",
      editedContent: {
        kind: "audio",
        segments: [{ text: "Curator rewording, presented as if sourced.", citations: [citation] }],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("CITATION_AUDIT_FAILED");
    expect(store.getDraft(audio.id).version).toBe(1);
  });

  it("an edit emptying the script is refused and stores nothing", () => {
    const { store, audio } = setup(fakeTts());
    const result = reviewArtifact({
      store,
      artifactId: audio.id,
      action: "edit",
      actor: "curator-1",
      editedContent: { kind: "audio", segments: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_EDIT");
    expect(store.getDraft(audio.id).content.segments.length).toBeGreaterThan(0);
  });

  it("refuses synthesis when a source changed, and invalidates the draft", () => {
    const tts = fakeTts();
    const { store, manifest, audio } = setup(tts);
    approveScript(store, audio.id);
    const changed = {
      ...manifest,
      documents: manifest.documents.map((doc, i) => (i === 0 ? { ...doc, contentHash: "b".repeat(64) } : doc)),
    };
    changed.sourceSetHash = computeSourceSetHash(changed.documents);
    store.saveSourceSet(changed);
    const result = synthesize(store, audio.id, tts);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("STALE_SOURCE");
    expect(store.getDraft(audio.id).stale).toBe(true);
  });

  it("approve-script and synthesize apply only to audio artifacts", () => {
    const { store, manifest, texts } = setup(fakeTts());
    const result = generateDrafts({ store, manifestId: manifest.id, documents: texts, curator: "curator-1" }, { tts: fakeTts() });
    const explainer = result.artifacts.find((artifact) => artifact.type === "explainer");
    expect(reviewArtifact({ store, artifactId: explainer.id, action: "approve-script", actor: "curator-1" }).error.code).toBe("INVALID_ACTION");
    expect(reviewArtifact({ store, artifactId: explainer.id, action: "synthesize", actor: "curator-1" }).error.code).toBe("INVALID_ACTION");
  });
});

describe("audio flow with no offline TTS engine (honest fallback)", () => {
  it("synthesize fails honestly, the draft stays script-only, and export is the transcript", () => {
    const tts = noTts();
    const { store, audio } = setup(tts);
    const actor = "curator-1";
    approveScript(store, audio.id, actor);

    const result = synthesize(store, audio.id, tts);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("TTS_UNAVAILABLE");
    const draft = store.getDraft(audio.id);
    expect(draft.content.audio).toBeNull();
    expect(store.getAudio(audio.id, draft.content.audio)).toBeNull();
    expect(draft.content.needsReview.map((item) => item.code)).toContain("TTS_UNAVAILABLE");

    // The preview never shows a player for a script-only draft.
    const preview = getArtifactPreview({ store, artifactId: audio.id });
    expect(preview.html).toMatch(/Script only/);
    expect(preview.html).not.toContain("<audio ");
    expect(getArtifactAudio({ store, artifactId: audio.id }).error.code).toBe("NOT_FOUND");

    // Approve, then export the transcript — labeled script-only,
    // never as completed audio.
    reviewArtifact({ store, artifactId: audio.id, action: "submit", actor });
    reviewArtifact({ store, artifactId: audio.id, action: "approve", actor });
    const exported = exportArtifact({ store, artifactId: audio.id });
    expect(exported.ok).toBe(true);
    expect(exported.filename).toBe(`${audio.id}-transcript.md`);
    expect(exported.mimeType).toContain("text/markdown");
    expect(exported.content).toMatch(/Approved audio overview/);
    expect(exported.content).toMatch(/Script only — no audio was synthesized/);
    expect(exported.content).not.toMatch(/Audio synthesized/);
    expect(exported.content).toContain("## Sources");
    expect(exported.content).toContain("## Manifest");
  });

  it("a draft cannot be exported before approval, even as a transcript", () => {
    const { store, audio } = setup(noTts());
    const exported = exportArtifact({ store, artifactId: audio.id });
    expect(exported.ok).toBe(false);
    expect(exported.error.code).toBe("NOT_EXPORTABLE");
  });
});

describe("audio cross-owner access", () => {
  it("another owner finds nothing — no draft, no audio, no export", () => {
    const tts = fakeTts();
    const { root, audio } = setup(tts);
    const other = createDraftStore(root, { ownerId: "owner-2" });
    const owner1 = createDraftStore(root, { ownerId: "owner-1" });
    const recorded = owner1.getDraft(audio.id).content.audio;
    expect(other.getDraft(audio.id)).toBeNull();
    expect(other.getAudio(audio.id, recorded)).toBeNull();
    expect(reviewArtifact({ store: other, artifactId: audio.id, action: "approve-script", actor: "curator-2" }).error.code).toBe("NOT_FOUND");
    expect(exportArtifact({ store: other, artifactId: audio.id }).error.code).toBe("NOT_FOUND");
    expect(getArtifactAudio({ store: other, artifactId: audio.id }).error.code).toBe("NOT_FOUND");
  });
});

// Slice C fix round 1 (ChatGPT NEEDS CHANGES at 73eb20e9, P1):
// the sidecar and the JSON record were published non-atomically, so a
// crash between them could serve audio the record never claimed.
// Sidecars are now content-addressed and immutable, the JSON record
// is the commit point, and reads verify bytes against the record.

/** Minimal PCM WAV with a seeded data section (same size/duration, different bytes). */
function makeWavSeeded(seed, dataSize = 16000) {
  const buffer = makeWav(dataSize);
  buffer.fill(seed, 44);
  return buffer;
}

/** Fake TTS returning different WAV bytes on every synthesis call. */
function variantTts() {
  let calls = 0;
  return {
    detectTtsCapability: () => FAKE_CAPABILITY,
    synthesizeAudio: ({ scriptText }) => {
      if (!scriptText || scriptText.length === 0) {
        return { ok: false, error: { code: "TTS_EMPTY_SCRIPT", message: "empty script" } };
      }
      const audio = makeWavSeeded(0x11 + calls);
      calls += 1;
      return { ok: true, audio, format: "wav", engine: "espeak-ng", durationSeconds: 1 };
    },
  };
}

function sidecarNames(root, artifactId) {
  return readdirSync(path.join(root, "owner-1", "drafts"))
    .filter((name) => name.endsWith(".wav"))
    .sort();
}

/** A store wrapper whose saveDraft throws for the first `failTimes` calls. */
function failingSaveDraftStore(store, failTimes = 1) {
  let remaining = failTimes;
  return {
    ...store,
    saveDraft: (artifact) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("injected JSON save failure");
      }
      return store.saveDraft(artifact);
    },
  };
}

describe("audio sidecar/record atomic publication", () => {
  it("repeated synthesis publishes the new recording and retires the old sidecar", () => {
    const tts = variantTts();
    const { root, store, audio } = setup(tts);
    approveScript(store, audio.id);
    expect(synthesize(store, audio.id, tts).ok).toBe(true);
    const first = store.getDraft(audio.id).content.audio;
    expect(first.present).toBe(true);
    expect(sidecarNames(root, audio.id)).toEqual([`${audio.id}.${first.sha256}.wav`]);
    expect(getArtifactAudio({ store, artifactId: audio.id }).content).toEqual(makeWavSeeded(0x11));

    expect(synthesize(store, audio.id, tts).ok).toBe(true);
    const second = store.getDraft(audio.id).content.audio;
    expect(second.sha256).not.toBe(first.sha256);
    expect(sidecarNames(root, audio.id)).toEqual([`${audio.id}.${second.sha256}.wav`]);
    expect(getArtifactAudio({ store, artifactId: audio.id }).content).toEqual(makeWavSeeded(0x12));
    // The old recording is no longer servable under its old record.
    expect(store.getAudio(audio.id, first)).toBeNull();
  });

  it("a JSON save failure during re-synthesis keeps the old committed audio and leaves no orphan", () => {
    const tts = variantTts();
    const { root, store, audio } = setup(tts);
    approveScript(store, audio.id);
    expect(synthesize(store, audio.id, tts).ok).toBe(true);
    const first = store.getDraft(audio.id).content.audio;
    const versionBefore = store.getDraft(audio.id).version;

    const failing = failingSaveDraftStore(store, 1);
    expect(() => synthesize(failing, audio.id, tts)).toThrow(/injected JSON save failure/);

    const draft = store.getDraft(audio.id);
    expect(draft.version).toBe(versionBefore);
    expect(draft.content.audio.sha256).toBe(first.sha256);
    expect(draft.content.scriptStatus).toBe("approved");
    expect(getArtifactAudio({ store, artifactId: audio.id }).content).toEqual(makeWavSeeded(0x11));
    expect(sidecarNames(root, audio.id)).toEqual([`${audio.id}.${first.sha256}.wav`]);

    // The next synthesis succeeds on the same approved script and
    // publishes the new recording; the old sidecar is retired.
    expect(synthesize(store, audio.id, tts).ok).toBe(true);
    const second = store.getDraft(audio.id).content.audio;
    expect(second.sha256).not.toBe(first.sha256);
    expect(sidecarNames(root, audio.id)).toEqual([`${audio.id}.${second.sha256}.wav`]);
    expect(getArtifactAudio({ store, artifactId: audio.id }).content).toEqual(makeWavSeeded(0x13));
  });

  it("an edit whose JSON save fails keeps the old recording", () => {
    const tts = variantTts();
    const { root, store, audio } = setup(tts);
    approveScript(store, audio.id);
    expect(synthesize(store, audio.id, tts).ok).toBe(true);
    const first = store.getDraft(audio.id).content.audio;
    const versionBefore = store.getDraft(audio.id).version;

    const draft = store.getDraft(audio.id);
    const failing = failingSaveDraftStore(store, 1);
    expect(() => reviewArtifact({
      store: failing,
      artifactId: audio.id,
      action: "edit",
      actor: "curator-1",
      editedContent: { kind: "audio", segments: draft.content.segments.slice(0, 1) },
    })).toThrow(/injected JSON save failure/);

    const stored = store.getDraft(audio.id);
    expect(stored.version).toBe(versionBefore);
    expect(stored.content.audio.sha256).toBe(first.sha256);
    expect(stored.content.scriptStatus).toBe("approved");
    expect(getArtifactAudio({ store, artifactId: audio.id }).content).toEqual(makeWavSeeded(0x11));
    expect(sidecarNames(root, audio.id)).toEqual([`${audio.id}.${first.sha256}.wav`]);
  });

  it("a corrupted or replaced sidecar fails closed on preview and export", () => {
    const tts = variantTts();
    const { root, store, audio } = setup(tts);
    const actor = "curator-1";
    approveScript(store, audio.id, actor);
    expect(synthesize(store, audio.id, tts).ok).toBe(true);
    reviewArtifact({ store, artifactId: audio.id, action: "submit", actor });
    reviewArtifact({ store, artifactId: audio.id, action: "approve", actor });
    const record = store.getDraft(audio.id).content.audio;
    const sidecar = path.join(root, "owner-1", "drafts", `${audio.id}.${record.sha256}.wav`);

    // One flipped byte: same length, wrong hash.
    const tampered = Buffer.from(makeWavSeeded(0x11));
    tampered[100] ^= 0xff;
    writeFileSync(sidecar, tampered);
    expect(getArtifactAudio({ store, artifactId: audio.id }).error.code).toBe("AUDIO_CORRUPT");
    expect(exportArtifact({ store, artifactId: audio.id }).error.code).toBe("AUDIO_CORRUPT");

    // Replaced with a different valid recording: hash mismatch.
    writeFileSync(sidecar, makeWavSeeded(0x12));
    expect(getArtifactAudio({ store, artifactId: audio.id }).error.code).toBe("AUDIO_CORRUPT");
    expect(exportArtifact({ store, artifactId: audio.id }).error.code).toBe("AUDIO_CORRUPT");

    // Missing bytes entirely: still fail closed, never a silent
    // script-only export for an artifact that claims audio.
    unlinkSync(sidecar);
    expect(getArtifactAudio({ store, artifactId: audio.id }).error.code).toBe("AUDIO_CORRUPT");
    const exported = exportArtifact({ store, artifactId: audio.id });
    expect(exported.ok).toBe(false);
    expect(exported.error.code).toBe("AUDIO_CORRUPT");
  });
});
