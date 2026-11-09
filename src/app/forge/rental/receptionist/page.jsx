import ReceptionistInboxClient from "@/components/forge/rental/ReceptionistInboxClient";
import { createClient } from "@/lib/supabase/server";

// Rental Manager > Calls / Receptionist inbox. Brandy-facing review UI:
// AI-captured calls, drafts pending review, emergency alert timeline.
// Server component only checks auth; the client component fetches the
// owner-scoped API routes. No tenant-visible portal content here.
export default async function ReceptionistInboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <main><p>Sign in to view the receptionist inbox.</p></main>;
  return (
    <main>
      <h1>Calls &amp; Receptionist</h1>
      <p>AI-captured calls for Brandy&apos;s review. Names, needs, and callback numbers are caller claims — unverified until Brandy confirms them. Drafts are not tenant or lead records until approved.</p>
      <ReceptionistInboxClient />
    </main>
  );
}
