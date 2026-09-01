"use client";

import { useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/theme/ThemeProvider";

const OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: SystemIcon },
];

const VARIANT_STYLES = {
  onDark: {
    trigger:
      "border-white/10 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10 hover:text-white",
    menu: "border-white/10 bg-slate-900",
    itemSelected: "bg-amber-400 text-slate-950",
    itemUnselected: "text-slate-200 hover:bg-white/10 hover:text-white",
  },
  onLight: {
    trigger:
      "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
    menu: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
    itemSelected: "bg-amber-400 text-slate-950",
    itemUnselected:
      "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  },
};

const MENU_POSITION = {
  "bottom-left": "left-0 top-full mt-2",
  "bottom-right": "right-0 top-full mt-2",
  right: "left-full top-0 ml-2",
};

export default function ThemeToggle({
  compact = false,
  menuAlign = "bottom-left",
  variant = "onDark",
  className = "",
}) {
  const { preference, setThemePreference } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.onDark;
  const active = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[2];
  const ActiveIcon = active.icon;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={["relative inline-block", className].join(" ")}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${active.label}. Open theme menu`}
        title={`Theme: ${active.label}`}
        onClick={() => setOpen((current) => !current)}
        className={[
          "flex items-center gap-2 rounded-xl border text-xs font-black transition",
          compact ? "h-9 w-9 justify-center" : "h-9 px-3",
          styles.trigger,
        ].join(" ")}
      >
        <ActiveIcon />
        {!compact && <span>{active.label}</span>}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Color theme"
          className={[
            "absolute z-50 w-36 overflow-hidden rounded-xl border p-1 shadow-xl",
            MENU_POSITION[menuAlign] ?? MENU_POSITION["bottom-left"],
            styles.menu,
          ].join(" ")}
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = preference === value;

            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setThemePreference(value);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-black transition",
                  selected ? styles.itemSelected : styles.itemUnselected,
                ].join(" ")}
              >
                <Icon />
                <span>{label}</span>
                {selected && <CheckIcon className="ml-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="currentColor"
    >
      <path d="M20.4 14.7A8.5 8.5 0 1 1 9.3 3.6a7 7 0 0 0 11.1 11.1Z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
