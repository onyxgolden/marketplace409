"use client";

import Link from "next/link";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";

// Every money action meets the 44px minimum touch target and goes full width
// on narrow screens, where the thumb is the pointer. On sm+ the controls
// shrink back to auto width so desktop density is unchanged.
const BASE_CONTROL =
  "flex w-full min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto";

const VARIANT_STYLES = {
  primary:
    "bg-slate-950 text-white hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300",
  secondary:
    "border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800",
  accent:
    "bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500",
  warn: "border border-amber-400 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40",
  gold: `${goldControlClassName} text-slate-950 dark:text-white`,
};

const INLINE_CONTROL =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-1 text-xs font-black transition disabled:opacity-40";

function controlClassName(variant, extra, base = BASE_CONTROL) {
  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.secondary;
  return [base, styles, FOCUS_RING, extra ?? ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * ForgeActionButton
 *
 * The shared thumb-friendly money action. Full-width and at least 44px tall
 * on mobile; auto-width on sm+ screens. Variants: primary (dark/amber),
 * secondary (bordered), accent (amber filled), warn (amber-bordered caution),
 * gold (metallic bulk applies).
 */
export function ForgeActionButton({
  variant = "secondary",
  className = "",
  ...rest
}) {
  return (
    <button
      type="button"
      {...rest}
      className={controlClassName(variant, className)}
    />
  );
}

/**
 * ForgeActionLink
 *
 * Same sizing and variants as ForgeActionButton, rendered as a Next Link.
 * For navigation-shaped actions (e.g. "Review") that must be as tappable as
 * their button siblings. Pass inline for links that sit inside a row of text
 * (keeps them in-flow but still 44px tall).
 */
export function ForgeActionLink({
  variant = "secondary",
  inline = false,
  className = "",
  ...rest
}) {
  return (
    <Link
      {...rest}
      className={controlClassName(
        variant,
        className,
        inline ? INLINE_CONTROL : BASE_CONTROL,
      )}
    />
  );
}

/**
 * ForgeActionStack
 *
 * Vertical stack for a row/card's actions: full-width children on mobile,
 * right-aligned and auto-width on sm+.
 */
export function ForgeActionStack({ className = "", ...rest }) {
  return (
    <div
      {...rest}
      className={[
        "flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:items-end",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
