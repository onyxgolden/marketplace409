import { createHash } from "node:crypto";

// Synthetic artifact model for the Coordinator prototype.
//
// The prototype parses ONLY allowlisted synthetic artifacts: a fixed set of
// kinds, under the `synthetic/` path namespace, supplied in-memory by the
// fixture harness. Free-text body content is inert data -- instruction-like
// text inside an artifact is recorded as present and otherwise ignored; it
// can never influence classification (prompt-injection rejection).

export const ARTIFACT_KINDS = Object.freeze([
  "task",
  "submission",
  "review",
  "agreement-check",
  "authorization",
  "authorization-claim",
  "standing-rule",
  "merged-record",
]);

export const VERDICTS = Object.freeze(["go", "needs_changes", "no_go"]);

const INSTRUCTION_LIKE = /ignore (all )?(prior|previous|above)|merge (pr|pull request)|approve (this|the|it)|disregard/i;

// Deterministic canonical serialization (stable key order) for hashing.
export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
}

export function contentSha256(artifact) {
  return createHash("sha256").update(canonicalStringify(artifact), "utf8").digest("hex");
}

// The immutable artifact identity used for dedup: file path + exact content
// hash. Two artifacts with the same head SHA but different content (or the
// same content at different paths) are distinct artifacts, not duplicates.
export function sourceFileId(artifact) {
  return { path: artifact.path, content_sha256: contentSha256(artifact) };
}

export function submissionIdFor(taskId, artifact) {
  const sfid = sourceFileId(artifact);
  return `sub:${taskId}:${sfid.path}:${sfid.content_sha256.slice(0, 12)}`;
}

export function reviewIdFor(taskId, artifact) {
  const sfid = sourceFileId(artifact);
  return `rev:${taskId}:r${artifact.review_round}:${sfid.content_sha256.slice(0, 12)}`;
}

// Validate the allowlist shape. Returns a list of rejection reasons (empty
// when the artifact may be parsed).
export function validateArtifactShape(artifact) {
  const reasons = [];
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return ["artifact is not an object"];
  }
  if (!ARTIFACT_KINDS.includes(artifact.kind)) {
    reasons.push(`artifact kind "${artifact.kind ?? "missing"}" is not in the allowlist`);
  }
  if (typeof artifact.path !== "string" || !artifact.path.startsWith("synthetic/")) {
    reasons.push(`artifact path "${artifact.path ?? "missing"}" is outside the synthetic/ allowlist namespace`);
  }
  if (typeof artifact.task_id !== "string" || artifact.task_id === "") {
    reasons.push("artifact is missing task_id");
  }
  if (artifact.kind === "review") {
    if (!VERDICTS.includes(artifact.verdict)) {
      reasons.push(`review verdict "${artifact.verdict ?? "missing"}" is not recognized`);
    }
    if (!Number.isInteger(artifact.review_round) || artifact.review_round < 1) {
      reasons.push("review_round must be a positive integer");
    }
  }
  return reasons;
}

// Instruction-like free text is noted, never obeyed.
export function hasInertInstructionText(artifact) {
  if (typeof artifact.body !== "string") return false;
  return INSTRUCTION_LIKE.test(artifact.body);
}
