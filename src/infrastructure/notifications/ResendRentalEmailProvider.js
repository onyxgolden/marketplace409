function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Resend rental email delivery requires ${name}.`);
  return value.trim();
}

export function createResendRentalEmailProvider(env = process.env, fetchImpl = fetch) {
  const apiKey = required(env.RESEND_API_KEY, "RESEND_API_KEY");
  const url = env.RESEND_EMAIL_API_URL?.trim() || "https://api.resend.com/emails";
  return { async send(message) {
    const response = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "Idempotency-Key": `rental-${message.id}` }, body: JSON.stringify({ from: `${message.senderName} <${message.senderEmail}>`, to: [message.recipient], subject: message.subject, text: message.bodyText, tags: [{ name: "notification_id", value: message.id }] }) });
    if (!response.ok) throw new Error(`Resend rejected email delivery (${response.status}).`);
    const body = await response.json(); if (!body.id) throw new Error("Resend did not return an email id."); return { messageId: String(body.id) };
  } };
}
