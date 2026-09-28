"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Phone layout: slide-over drawer that hosts a docked panel below the md
 * breakpoint. Rendered only below md (the `md:hidden` wrapper); on md+ the
 * caller renders the panel docked instead.
 *
 * Modal behavior: on open, focus moves to the first focusable element (or the
 * panel itself); Tab/Shift+Tab is contained inside the panel; on close, focus
 * is restored to whatever had it before the drawer opened. Escape and the
 * backdrop also close it.
 *
 * `side` is "right" (default) or "left" — the tools library drawer docks left.
 */
export function MobileDrawer({ open, onClose, label, children, side = "right" }) {
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  // onClose identity may change every render (inline arrow); keep the effect
  // keyed on `open` only so focus isn't stolen on unrelated re-renders.
  const onCloseRef = useRef(onClose);
  // Keep the ref current without touching it during render (react-hooks/refs).
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusables = () => (panel ? [...panel.querySelectorAll(FOCUSABLE_SELECTOR)] : []);

    // Focus on open.
    const initial = focusables();
    if (initial.length > 0) initial[0].focus();
    else panel?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      // Tab containment: wrap around the first/last focusable element.
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger on close.
      const trigger = triggerRef.current;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open ]);

  if (!open) return null;
  const left = side === "left";
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
        data-testid="mobile-drawer-backdrop"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`absolute inset-y-0 flex w-80 max-w-[85vw] flex-col overflow-y-auto bg-gray-900 p-3 ${
          left ? "left-0 border-r border-gray-800" : "right-0 border-l border-gray-800"
        }`}
      >
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label={`Close ${label}`}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
