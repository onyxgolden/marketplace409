// Pure builders for the new-sign-in alert email. No I/O here -- the route owns
// sending. Deliberate PII floor: the email carries city/country, time, and a
// coarse device hint only. The raw IP address is recorded in login_history but
// never emailed.

export function locationLabel(country, city) {
  const parts = [city, country].filter((part) => typeof part === "string" && part.trim());
  return parts.length > 0 ? parts.join(", ") : "Unknown location";
}

// Coarse device hint from a user-agent string -- browser + OS family only,
// never the full UA string (which can carry device-identifying detail).
export function deviceHintFromUserAgent(userAgent) {
  if (typeof userAgent !== "string" || !userAgent) return "Unknown device";
  const ua = userAgent;

  let os = null;
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = null;
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = "Safari";

  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Unknown device";
}

export function formatSignInTime(occurredAt) {
  const date = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

// Builds the Resend message shape { id, senderName, senderEmail, recipient,
// subject, bodyText }. approveUrl/denyUrl are absolute links to
// /auth/verify-location?token=...&action=...; resetUrl points at the
// password-reset page for the deny path.
export function buildNewSignInAlertEmail({
  id,
  senderName,
  senderEmail,
  recipient,
  country,
  city,
  occurredAt,
  userAgent,
  approveUrl,
  denyUrl,
  resetUrl,
}) {
  if (!recipient) throw new Error("buildNewSignInAlertEmail requires a recipient.");
  if (!approveUrl || !denyUrl) throw new Error("buildNewSignInAlertEmail requires approve and deny URLs.");

  const where = locationLabel(country, city);
  const when = formatSignInTime(occurredAt);
  const device = deviceHintFromUserAgent(userAgent);

  const subject = "New sign-in to your 409 Marketplace account";
  const bodyText =
    `We noticed a sign-in to your 409 Marketplace account from a location we haven't seen before.\n` +
    `\n` +
    `Location: ${where}\n` +
    `Time: ${when}\n` +
    `Device: ${device}\n` +
    `\n` +
    `Was this you?\n` +
    `  Yes, this was me: ${approveUrl}\n` +
    `  No, this wasn't me: ${denyUrl}\n` +
    `\n` +
    `These links expire in 24 hours and work only once. If you don't recognize this sign-in, choose ` +
    `"No, this wasn't me" and change your password right away: ${resetUrl}\n` +
    `\n` +
    `If you were traveling or on a new network, approving once is all you need -- we won't ask about ` +
    `that location again.`;

  return { id, senderName, senderEmail, recipient, subject, bodyText };
}
