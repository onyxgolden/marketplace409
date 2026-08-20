// Impact's website-ownership verification tag for 409marketplace.online. This is public site
// metadata (not a credential) that Impact's crawler checks for on the homepage <head>.
//
// Impact requires the literal `value` attribute, not the more common `content` attribute most
// verification meta tags use — Next.js's built-in Metadata API (`metadata.other`/`verification`)
// always renders `content`, so this tag is rendered directly rather than through that API.
//
// No tracking script, cookie, analytics package, or affiliate link is added here — this is only
// the static ownership-verification tag Impact asked for.
const IMPACT_SITE_VERIFICATION_VALUE = "e72e3994-89a5-4e25-9c42-6bb892d9d0c8";

export default function ImpactSiteVerificationMeta() {
  return <meta name="impact-site-verification" value={IMPACT_SITE_VERIFICATION_VALUE} />;
}
