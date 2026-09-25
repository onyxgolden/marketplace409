// FORGE Capture — AI Edit session driver (ui/ai-edit.js).
//
// Framework-neutral, DOM-free state machine for the AI Edit "plugin" flow.
// Runs unmodified under vitest (node) and in the Tauri webview. The DOM
// (prompt dialog, status line, library updates) lives in main.js; this
// module owns the job lifecycle: submit → poll → import.
//
// The transport is a LOCAL spool contract (see
// forge-capture-app/docs/ai-edit.md): Capture writes {input.png,
// prompt.txt, job.json} to the ai-spool and polls the directory state.
// An external runner carries jobs to the AI team and drops results back.
// Until a runner exists, jobs sit honestly in `pending/` — this module
// says so instead of spinning forever.

export const AI_EDIT_PROMPT_MAX = 2000;
export const AI_EDIT_POLL_MS = 2000;
// How long a job may sit queued/processing before we tell the user the
// honest truth: no runner has picked it up yet.
export const AI_EDIT_RUNNER_HINT_MS = 10000;

export const AI_EDIT_STATES = Object.freeze([
  "idle",
  "submitting",
  "queued",
  "processing",
  "done",
  "failed",
  "importing",
  "imported",
  "cancelled",
]);

/// Mirror of core/src/ai_edit.rs `validate_prompt`: instant client-side
/// feedback before the backend re-validates.
export function validateAiPrompt(prompt) {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return { ok: false, error: "Describe what should change first." };
  }
  if (prompt.length > AI_EDIT_PROMPT_MAX) {
    return {
      ok: false,
      error: `Prompt is too long (${prompt.length}/${AI_EDIT_PROMPT_MAX} characters).`,
    };
  }
  return { ok: true, prompt: prompt.trim() };
}

export class AiEditSession {
  /**
   * @param {object} deps
   * @param {(cmd: string, args: object) => Promise<any>} deps.invoke - Tauri invoke bridge
   * @param {string} deps.captureId - source capture id
   * @param {(evt: {state: string, text: string, reason?: string}) => void} [deps.onEvent] - state-change sink
   */
  constructor({ invoke, captureId, onEvent }) {
    if (typeof invoke !== "function") throw new Error("invoke is required");
    if (!captureId) throw new Error("captureId is required");
    this.invoke = invoke;
    this.captureId = captureId;
    this.onEvent = onEvent || (() => {});
    this.state = "idle";
    this.jobId = null;
    this.reason = null;
    this.submittedAt = 0;
    this.runnerHint = false;
    this.importedRef = null;
    this.timer = null;
  }

  get active() {
    return ["submitting", "queued", "processing", "importing"].includes(this.state);
  }

  statusText() {
    switch (this.state) {
      case "submitting":
        return "Sending to AI…";
      case "queued":
        return this.runnerHint
          ? "Still queued — no AI runner has picked up the job yet. See Help → AI Edit for the runner setup."
          : "Queued — waiting for the AI runner…";
      case "processing":
        return this.runnerHint
          ? "Still working — the AI runner is taking a while. See Help → AI Edit for the runner setup."
          : "AI is working on it…";
      case "done":
        return "Done — import the result as a new versioned copy.";
      case "failed":
        return `AI Edit failed: ${this.reason || "unknown error"}`;
      case "importing":
        return "Importing the result…";
      case "imported":
        return "Imported as a new versioned copy — the original is untouched.";
      case "cancelled":
        return "AI Edit cancelled.";
      default:
        return "";
    }
  }

  emit() {
    this.onEvent({ state: this.state, text: this.statusText(), reason: this.reason });
  }

  async submit(prompt, now = Date.now()) {
    if (this.state !== "idle") throw new Error(`cannot submit from state ${this.state}`);
    const v = validateAiPrompt(prompt);
    if (!v.ok) throw new Error(v.error);
    this.state = "submitting";
    this.emit();
    const { jobId } = await this.invoke("ai_edit_submit", {
      id: this.captureId,
      prompt: v.prompt,
    });
    if (!jobId || typeof jobId !== "string") throw new Error("backend returned no job id");
    this.jobId = jobId;
    this.submittedAt = now;
    this.state = "queued";
    this.emit();
    this.startPolling();
    return jobId;
  }

  startPolling() {
    this.stopPolling();
    this.timer = setInterval(() => {
      this.pollOnce().catch(() => {
        /* pollOnce reports failures through onEvent itself */
      });
    }, AI_EDIT_POLL_MS);
  }

  stopPolling() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single poll round; returns the new state. Safe to call directly in tests. */
  async pollOnce(now = Date.now()) {
    if (!["queued", "processing"].includes(this.state) || !this.jobId) return this.state;
    let res;
    try {
      res = await this.invoke("ai_edit_poll", { jobId: this.jobId });
    } catch (err) {
      // A backend error here (e.g. job vanished) will not heal by
      // retrying: fail honestly and stop polling.
      this.stopPolling();
      this.state = "failed";
      this.reason = String((err && err.message) || err);
      this.emit();
      return this.state;
    }
    const status = res && res.status;
    if (status === "done" || status === "failed") {
      this.stopPolling();
      this.state = status;
      this.reason = res.reason || null;
    } else if (status === "queued" || status === "processing") {
      this.state = status;
    }
    // Unknown status strings are ignored: the job keeps its last known
    // state rather than jumping somewhere invented.
    if (["queued", "processing"].includes(this.state)) {
      this.runnerHint = now - this.submittedAt > AI_EDIT_RUNNER_HINT_MS;
    }
    this.emit();
    return this.state;
  }

  /**
   * Import the finished result as a versioned copy. Allowed exactly once,
   * from `done`; the backend moves the job to `imported/` so a second
   * import is refused there too.
   */
  async importResult() {
    if (this.state !== "done") throw new Error(`nothing to import from state ${this.state}`);
    this.state = "importing";
    this.emit();
    const ref = await this.invoke("ai_edit_import", { jobId: this.jobId });
    this.importedRef = ref;
    this.state = "imported";
    this.emit();
    return ref;
  }

  cancel() {
    if (!this.active) return;
    this.stopPolling();
    this.state = "cancelled";
    this.emit();
  }
}
