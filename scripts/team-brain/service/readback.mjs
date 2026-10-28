// Team Brain slice 4 — independent readback receipts.
//
// A readback receipt is PRODUCED by this module from bytes fetched
// through an injected Git reader, never accepted from a caller claim.
// There is no `verified` input anywhere in this module: passing one is
// refused outright (INVALID_READBACK_CLAIM), because a caller asserting
// verification is exactly the attestation the brief forbids ("Caller
// verified:true is never accepted", Section 3).
//
// The reader is deliberately a separate adapter from any writer: the
// host injects a read path that does not share the writer's buffers, so
// a writer-side lie (a claimed blob that does not match stored bytes)
// is caught here. The receipt records both the expected and the
// actually observed digests, so a mismatch is diagnosable, not silent.
//
// Reader contract (host-injected `git`):
//   read({ repo, commit, path }) -> { bytes: string }
//     Throws a TeamBrainError with code GIT_NOT_FOUND when the pinned
//     commit/path has no content, GIT_UNAVAILABLE when the transport
//     cannot be reached. Any other throw is wrapped as
//     READBACK_UNAVAILABLE with the original code preserved in details.
//   The reader's own blob/commit claims, if any are returned, are
//   IGNORED for trust: the blob is recomputed from the bytes here.

import { gitBlobSha1, sha256Hex, assertFullHex40 } from "./gitIdentity.mjs";
import { fail, P4_CODES } from "./errors.mjs";
import { assertNonEmptyString, assertUtcIso, utcIsoToMs } from "../ledger/validation.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

export function readbackReceiptId({ repo, path, commit, blob, verifier, checkedAt }) {
  return `rb-${sha256Hex(stableStringify({ repo, path, commit, blob, verifier, checkedAt })).slice(0, 24)}`;
}

export function createIndependentReadback({ git, method = "independent-git-read" }) {
  if (!git || typeof git.read !== "function") {
    fail(P4_CODES.READBACK_UNAVAILABLE, "Independent readback requires a git adapter with a read function", {});
  }

  // Fetch pinned commit/path bytes and compare them, byte for byte and
  // blob for blob, against the expected outcome. Returns the receipt on
  // an exact match; throws otherwise with the state untouched by the
  // caller (this function mutates nothing).
  //
  // `options.verified` is refused, not ignored: silently dropping a
  // caller verification claim would let a caller believe it had been
  // honored. `expectedRecordedAt` is an optional time-order floor:
  // a receipt checked before the outcome was recorded is impossible
  // and refused as TIME_ORDER.
  async function verifyBytes({
    repo,
    commit,
    path,
    expectedBytes,
    expectedBlob,
    verifier,
    checkedAt,
    reason,
    expectedRecordedAt = null,
    ...rest
  }) {
    if (rest.verified !== undefined) {
      fail(
        P4_CODES.INVALID_READBACK_CLAIM,
        "Readback refuses a caller-supplied verified claim; verification comes only from an independent Git read",
        {},
      );
    }
    assertNonEmptyString(repo, "readback.repo");
    assertFullHex40(commit, "readback.commit");
    assertNonEmptyString(path, "readback.path");
    assertFullHex40(expectedBlob, "readback.expectedBlob");
    if (typeof expectedBytes !== "string") {
      fail(P4_CODES.READBACK_MISMATCH, "Readback expects exact outcome bytes as a string", {});
    }
    assertNonEmptyString(verifier, "readback.verifier");
    assertUtcIso(checkedAt, "readback.checkedAt");
    assertNonEmptyString(reason, "readback.reason");
    if (expectedRecordedAt !== null) {
      const checkedMs = utcIsoToMs(checkedAt, "readback.checkedAt");
      const recordedMs = utcIsoToMs(expectedRecordedAt, "readback.expectedRecordedAt");
      if (checkedMs < recordedMs) {
        fail(P4_CODES.TIME_ORDER, `Readback checkedAt ${checkedAt} precedes outcome recordedAt ${expectedRecordedAt}`, {
          checkedAt,
          recordedAt: expectedRecordedAt,
        });
      }
    }

    let observed;
    try {
      observed = await git.read({ repo, commit, path });
    } catch (error) {
      if (error && error.code === P4_CODES.GIT_NOT_FOUND) throw error;
      if (error && error.code === P4_CODES.GIT_UNAVAILABLE) throw error;
      fail(P4_CODES.READBACK_UNAVAILABLE, `Independent Git read failed: ${error && error.message ? error.message : String(error)}`, {
        originalCode: error && error.code ? error.code : null,
      });
    }
    const actualBytes = observed && typeof observed.bytes === "string" ? observed.bytes : null;
    if (actualBytes === null) {
      fail(P4_CODES.READBACK_MISMATCH, "Independent Git read returned no bytes for the pinned commit/path", {
        repo,
        path,
        commit,
      });
    }
    const actualBlob = gitBlobSha1(actualBytes);
    const expectedBytesSha256 = sha256Hex(expectedBytes);
    const actualBytesSha256 = sha256Hex(actualBytes);
    const diffs = [];
    if (actualBytes !== expectedBytes) diffs.push("bytes");
    if (actualBlob !== expectedBlob) diffs.push("blob");
    if (diffs.length > 0) {
      fail(P4_CODES.READBACK_MISMATCH, `Independent readback mismatch on ${diffs.join(", ")} for ${repo}/${path}@${commit}`, {
        repo,
        path,
        commit,
        diffs,
        expectedBlob,
        actualBlob,
        expectedBytesSha256,
        actualBytesSha256,
      });
    }
    return {
      receiptId: readbackReceiptId({ repo, path, commit, blob: expectedBlob, verifier, checkedAt }),
      repo,
      path,
      commit,
      expectedBlob,
      actualBlob,
      expectedBytesSha256,
      actualBytesSha256,
      verifier,
      method,
      reason,
      checkedAt,
      status: "VERIFIED",
    };
  }

  return { verifyBytes, method };
}
