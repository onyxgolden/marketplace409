import Link from "next/link";

/**
 * Work Packages landing header: the Rung 1 heading/subheading plus the
 * Document library, Admin, and New package actions.
 *
 * Extracted verbatim from page.jsx (no behavior change) so the
 * phone-layout geometry fixture renders this real header instead of a
 * copy of its markup — a copy's measurements would prove nothing about
 * the page users actually open.
 *
 * Phone Slice 5: below the sm breakpoint the header stacks into two
 * rows (heading above, actions below) — the single row needs ~372px plus
 * the page's 32px of padding, so at 360/390px the New package link was
 * pushed past the viewport edge. At sm and up it is the original row,
 * unchanged.
 */
export default function WorkPackagePageHeader({ heading, subheading, newPackageHref }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold">{heading}</h1>
        <p className="mt-1 text-sm text-slate-500">{subheading}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* D11: these two links had no dark: overrides at all -- a
           dark-gray border and dark-gray text on the page's dark
           background rendered as near-invisible "grey-on-dark", unlike
           New package's solid dark-pill/white-text style below, which
           stays readable in either theme without an override. */}
        <Link
          href="/forge/work/documents"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Document library
        </Link>
        <Link
          href="/forge/work/admin"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Admin
        </Link>
        <Link
          href={newPackageHref}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New package
        </Link>
      </div>
    </div>
  );
}
