function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pseudonymizeAnalyticsId(scope, internalId, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle || typeof internalId !== "string" || !internalId || !["user", "workspace"].includes(scope)) {
    return null;
  }

  const input = new TextEncoder().encode(`forge-analytics-v1:${scope}:${internalId}`);
  const digest = await cryptoImpl.subtle.digest("SHA-256", input);
  return `${scope}_${bytesToHex(new Uint8Array(digest)).slice(0, 32)}`;
}
