import { redirect } from "next/navigation";

// Compatibility entry point: the standalone Property application was absorbed into Rental
// Manager's Properties section. Existing bookmarks land on the Properties section (not the
// Dashboard default) via the rental route's `?section=` selector.
export default function PropertyPage() {
  redirect("/forge/rental?section=properties");
}
