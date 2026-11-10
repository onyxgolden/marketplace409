import { notFound } from "next/navigation";

// D8(a) fix: /forge/work-packages/<id> (no suffix) never had real content —
// the only real route under this segment is .../takeoff — so it fell
// through to the site-wide generic 404 with no link back to the planner.
// This page exists only to call notFound() so the scoped not-found.jsx in
// this subtree renders instead, inside the Planner's own layout chrome.
export default function WorkPackagesBareSegment() {
  notFound();
}
