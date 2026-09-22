"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal right-click context menu for rental cards (Brandy's power-user shortcut).
// useCardContextMenu() returns { menu, onContextMenu }: attach onContextMenu to the card,
// pass items: [{ label, onSelect }]. The menu renders fixed-position at the cursor, closes
// on outside click / Escape / scroll, and keeps keyboard focus reachable.
export function useCardContextMenu() {
  const [menu, setMenu] = useState(null); // { x, y, items }
  const close = useCallback(() => setMenu(null), []);
  const onContextMenu = useCallback((event, items) => {
    // Never steal the native menu from form fields — the shortcut is for the card itself.
    if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
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
  return { menu, onContextMenu, close };
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
