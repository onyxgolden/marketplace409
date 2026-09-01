// Custom "Launch FORGE" mark: a hammer striking an anvil, with small dollar-sign sparks flying
// off -- the plain lucide Hammer icon it replaces didn't carry the "financial forge" idea on its
// own. Drawn from scratch (not the lucide Hammer path) because that path fills its whole 24x24 box
// diagonally, leaving no room for an anvil or sparks underneath at small sizes. Stroked lines match
// the surrounding lucide icons; the sparks are filled "$" glyphs, the one deliberately non-stroked
// accent, so they read as small marks rather than more line art.
export default function ForgeHammerAnvilIcon({ className = "h-4 w-4", "aria-hidden": ariaHidden = true }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={ariaHidden}
    >
      <path d="M8 3.5h6l1.5 1.5v2h-9v-2z" />
      <path d="M11.3 7 9.5 14" />
      <path d="M6.5 15h9l-1 2.4h-7z" />
      <path d="M8.2 17.4h5.6l.7 2.1a1 1 0 0 1-.95 1.3H8.45a1 1 0 0 1-.95-1.3z" />
      <text x="2.2" y="12.5" fontSize="5.5" fontWeight="700" stroke="none" fill="currentColor">$</text>
      <text x="17.6" y="10.5" fontSize="5.5" fontWeight="700" stroke="none" fill="currentColor">$</text>
      <text x="17.2" y="17.5" fontSize="5" fontWeight="700" stroke="none" fill="currentColor">$</text>
    </svg>
  );
}
