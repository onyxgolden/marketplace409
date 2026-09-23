"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal right-click context menu for rental cards (Brandy's power-user shortcut).
// useCardContextMenu() returns { menu, onContextMenu, openAt, close }: attach onContextMenu
// to the card, pass items: [{ label, onSelect }]. The menu renders fixed-position at the
// cursor, closes on outside click / Escape / scroll, and keeps keyboard focus reachable.
//
// Native-menu suppression is triple-guarded so the browser's own context menu NEVER
// appears over a card region:
//   1. Cards mark themselves with data-context-menu-card (see CARD_REGION_ATTRIBUTE).
//   2. A document-level capture-phase native listener preventDefaults every contextmenu
//      event inside such a region — this runs before React's synthetic system, so even a
//      missed synthetic handler or a child that stops propagation cannot leak the native menu.
//   3. The React onContextMenu handler also preventDefaults + stopImmediatePropagation.
// The one deliberate exception: real form fields (input/textarea/select/contenteditable)
// keep their native menu so copy/paste and spellcheck keep working — the shortcut is for
// the card surface, not for editing text. A visible ⋮ button opens the same menu for
// touch users; wire it through openAt(x, y, items).

export const CARD_REGION_ATTRIBUTE = "data-context-menu-card";

const CARD_SELECTOR = `[${CARD_REGION_ATTRIBUTE}]`;
const FORM_FIELD_SELECTOR = "input, textarea, select, [contenteditable='true']";

function isFormField(target) {
  return Boolean(target?.closest?.(FORM_FIELD_SELECTOR));
}

function isInCardRegion(target) {
  return Boolean(target?.closest?.(CARD_SELECTOR));
}

export function useCardContextMenu() {
  const [menu, setMenu] = useState(null); // { x, y, items }
  const close = useCallback(() => setMenu(null), []);
  const openAt = useCallback((x, y, items) => {
    if (!items?.length) return;
    setMenu({ x, y, items });
  }, []);
  const onContextMenu = useCallback((event, items) => {
    // Never steal the native menu from form fields — the shortcut is for the card itself.
    if (isFormField(event.target)) return;
    event.preventDefault();
    // Stop any other contextmenu listener on the path from re-showing the native menu.
    if (typeof event.nativeEvent?.stopImmediatePropagation === "function") {
      event.nativeEvent.stopImmediatePropagation();
    }
    event.stopPropagation();
    openAt(event.clientX, event.clientY, items);
  }, [openAt]);

  // Guard 2: native capture-phase suppression. Installed once per hook instance; the
  // handlers are identical and cheap, and each cleans up on unmount.
  useEffect(() => {
    const suppressNativeMenu = (event) => {
      if (!isInCardRegion(event.target) || isFormField(event.target)) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", suppressNativeMenu, true);
    return () => document.removeEventListener("contextmenu", suppressNativeMenu, true);
  }, []);

  useEffect(() => {
    if (!menu) return undefined;
    const dismiss = () => close();
    const onKey = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);
  return { menu, onContextMenu, openAt, close };
}

export function CardContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (menu && ref.current) {
      const first = ref.current.querySelector("button");
      first?.focus();
    }
  }, [menu]);
  if (!menu) return null;
  const { innerWidth = 1024, innerHeight = 768 } = typeof window === "undefined" ? {} : window;
  const x = Math.min(menu.x, innerWidth - 260);
  const y = Math.min(menu.y, innerHeight - menu.items.length * 44 - 16);
  return (
    <div ref={ref} role="menu" aria-label="Card actions"
      className="fixed z-50 w-60 rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      style={{ left: Math.max(8, x), top: Math.max(8, y) }}>
      {menu.items.map((item) => (
        <button key={item.label} type="button" role="menuitem"
          onClick={(event) => { event.stopPropagation(); onClose(); item.onSelect(); }}
          className="block w-full px-4 py-2.5 text-left text-sm font-bold text-slate-800 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
          {item.label}
        </button>
      ))}
    </div>
  );
}
