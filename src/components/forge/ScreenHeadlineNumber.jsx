// ScreenHeadlineNumber: the "one number per screen" pattern shared by the
// FORGE financial surfaces. Every major screen answers one core question in
// one large number, with a one-line plain-English caption; everything else is
// drill-down detail below. Mirrors the morning-queue inbox header so the
// screens feel like one product. No LLM calls, no I/O -- pure presentation.
import Link from "next/link";
import { forgeTheme } from "@/components/forge/theme";

const TONE_NUMBER = Object.freeze({
  positive: "text-emerald-700 dark:text-emerald-400",
  negative: "text-red-700 dark:text-red-400",
  neutral: "text-slate-950 dark:text-slate-50",
});

export default function ScreenHeadlineNumber({
  value,
  label,
  caption = null,
  tone = "neutral",
  href = null,
  testId = null,
}) {
  const numberClass = `text-5xl font-black ${TONE_NUMBER[tone] ?? TONE_NUMBER.neutral}`;
  const content = (
    <>
      <div className={numberClass} data-testid={testId}>
        {value}
      </div>
      <div className={forgeTheme.labelSmall}>{label}</div>
      {caption ? (
        <p className="mt-1 max-w-xs text-sm text-slate-600 dark:text-slate-400">{caption}</p>
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="text-right transition hover:opacity-80">
        {content}
      </Link>
    );
  }
  return <div className="text-right">{content}</div>;
}

/**
 * describeDecisionBacklog(count) -- the connections screen's one number:
 * "How many transactions still need a decision?"
 *
 * Pure. Never throws on missing/non-numeric input -- unknown reads as "not
 * loaded yet" (null caption), never as zero, so the header shows a dash
 * instead of a misleading "0".
 */
export function describeDecisionBacklog(count) {
  if (count == null || !Number.isFinite(Number(count))) {
    return { value: "–", caption: null, loaded: false };
  }
  const n = Math.max(0, Math.floor(Number(count)));
  if (n === 0) {
    return { value: "0", caption: "Nothing needs a decision. Queue's clear.", loaded: true };
  }
  const noun = n === 1 ? "transaction needs" : "transactions need";
  return {
    value: String(n),
    caption: `${n} ${noun} a decision — clear it in the inbox.`,
    loaded: true,
  };
}
