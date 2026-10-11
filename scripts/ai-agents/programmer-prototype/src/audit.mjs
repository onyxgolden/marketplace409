/**
 * audit.mjs — host-owned append-only audit writer (JSONL).
 * Every attempted capability and decision gets a bounded audit event.
 * The audit file lives under the host output root, never inside a
 * candidate-writable tree.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { REASON } from "./constants.mjs";

const MAX_EVENT_BYTES = 16 * 1024;
const MAX_EVENTS_PER_RUN = 200;

export class AuditWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.seq = 0;
    this.failed = false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "", "utf8");
  }

  event(type, data = {}) {
    if (this.failed) return null;
    if (this.seq >= MAX_EVENTS_PER_RUN) {
      this.failed = true;
      return null;
    }
    this.seq += 1;
    let payload;
    try {
      payload = JSON.stringify(data);
    } catch {
      payload = '{"unserializable":true}';
    }
    if (payload.length > MAX_EVENT_BYTES) {
      payload = JSON.stringify({ truncated: true, sha256: createHash("sha256").update(payload).digest("hex") });
    }
    const line = JSON.stringify({ seq: this.seq, ts: new Date().toISOString(), type, data: JSON.parse(payload) });
    try {
      fs.appendFileSync(this.filePath, line + "\n", "utf8");
    } catch {
      this.failed = true;
      return null;
    }
    return this.seq;
  }

  finalize() {
    if (this.failed) return { ok: false, reason: REASON.AUDIT_FAILED };
    let digest = null;
    try {
      digest = createHash("sha256").update(fs.readFileSync(this.filePath)).digest("hex");
    } catch {
      return { ok: false, reason: REASON.AUDIT_FAILED };
    }
    return { ok: true, path: this.filePath, sha256: digest, events: this.seq };
  }
}

/** Read back an audit file for reporting (bounded). */
export function readAudit(filePath, maxLines = 500) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).slice(0, maxLines);
  return lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { malformed: true };
    }
  });
}
