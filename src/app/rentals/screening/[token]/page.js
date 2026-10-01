import ScreeningApplicantForm from "@/components/forge/rental/ScreeningApplicantForm";

export const metadata = {
  title: "Tenant screening",
  description: "Provide your screening information and consent for a rental application.",
  robots: { index: false, follow: false },
};

// Rentec parity R22 — the applicant's no-login screening link page.
// The token is a random 24-char secret scoped to one screening; guessing
// it yields a 404 from the API layer.
export default async function ScreeningLinkPage({ params }) {
  const { token } = await params;
  return <ScreeningApplicantForm token={token} />;
}
