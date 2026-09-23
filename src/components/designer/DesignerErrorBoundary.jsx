"use client";

import { Component } from "react";
import { draftKey, readDraft } from "./designerDraft";

/**
 * Crash-resilience: React error boundary around the designer canvas and the
 * 3D viewport. A render exception (or any other React-phase error) shows a
 * recovery panel instead of unmounting the whole page into a blank screen.
 *
 * The boundary never attempts to resurrect the crashed in-memory document:
 * on crash it checks the autosave draft first. When a draft exists, the
 * primary action reloads into the recovery offer; only when no draft exists
 * does it reload straight to the server revision.
 *
 * Note: errors thrown synchronously inside event handlers (e.g. a reducer
 * throw during dispatch) are not catchable by error boundaries — the domain
 * layer stays total (clamp, never throw) so that path cannot recur.
 */
export default class DesignerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null, draft: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    let draft = null;
    try {
      draft = readDraft(this.props.projectId);
    } catch {
      draft = null;
    }
    this.setState({ errorInfo, draft });
  }

  render() {
    const { error, errorInfo, draft, copied } = this.state;
    if (!error) return this.props.children;

    const reload = () => window.location.reload();
    const discardDraftAndReload = () => {
      try {
        localStorage.removeItem(draftKey(this.props.projectId));
      } catch {
        // Best effort only.
      }
      window.location.reload();
    };
    const copyDiagnostics = async () => {
      const text = [
        `Designer crash — ${new Date().toISOString()}`,
        `projectId: ${this.props.projectId}`,
        `error: ${error && error.stack ? error.stack : String(error)}`,
        `component stack: ${errorInfo && errorInfo.componentStack ? errorInfo.componentStack : "(none)"}`,
      ].join("\n");
      try {
        await navigator.clipboard.writeText(text);
        this.setState({ copied: true });
      } catch {
        this.setState({ copied: false });
      }
    };

    return (
      <div className="flex h-full items-center justify-center bg-gray-950 p-6">
        <div
          className="w-full max-w-lg rounded-lg bg-gray-900 p-6 shadow-xl"
          role="alertdialog"
          aria-modal="true"
          aria-label="Designer crashed"
        >
          <h2 className="text-lg font-semibold text-white">Something went wrong in the designer</h2>
          <p className="mt-2 text-sm text-gray-300">
            The drawing view crashed instead of losing your work silently. Your last
            server save is intact
            {draft
              ? ", and an autosaved draft exists — reloading will offer to recover your unsaved work."
              : "."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {draft ? (
              <>
                <button
                  type="button"
                  onClick={reload}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Recover unsaved work
                </button>
                <button
                  type="button"
                  onClick={discardDraftAndReload}
                  className="rounded bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-600"
                >
                  Discard draft &amp; reload saved version
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={reload}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Reload saved version
              </button>
            )}
            <button
              type="button"
              onClick={copyDiagnostics}
              className="rounded bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-600"
            >
              {copied ? "Diagnostic info copied" : "Copy diagnostic info"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
