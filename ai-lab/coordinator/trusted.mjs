// Injected trusted dependencies for the Coordinator prototype.
//
// These stores are the ONLY source of authenticated provenance. They are
// populated by a channel outside any agent's repo-write access; in this
// fixture-only prototype the tests populate them directly as ground truth.
//
// The Coordinator itself only ever calls the READ methods
// (lookupPrincipal / getToken / listTokens). The write methods below exist
// so fixtures can simulate the external channel (registering an attestation,
// revoking a token). The Coordinator never mints, refreshes, extends, or
// revokes trusted records, and nothing in parsed artifact content can create
// or alter a record here.

// TrustedProvenanceRegistry: maps a run_id / authorization_id to the
// principal that an independent channel attests actually performed it.
export function createTrustedProvenanceRegistry(initialEntries = []) {
  const entries = new Map();

  function register({ run_id, authorization_id, principal_id, attested_at } = {}) {
    const key = run_id ?? authorization_id;
    if (key == null) throw new Error("registry entry requires run_id or authorization_id");
    entries.set(key, { key, run_id: run_id ?? null, authorization_id: authorization_id ?? null, principal_id, attested_at: attested_at ?? null });
    return entries.get(key);
  }

  for (const entry of initialEntries) register(entry);

  return {
    // --- fixture-side write path (simulates the external channel) ---
    register,
    remove(key) {
      return entries.delete(key);
    },
    // --- coordinator-side read path ---
    lookupPrincipal({ run_id, authorization_id } = {}) {
      const key = run_id ?? authorization_id;
      if (key == null) return null;
      const entry = entries.get(key);
      return entry ? entry.principal_id : null;
    },
    has(key) {
      return entries.has(key);
    },
  };
}

// TrustedChannelStore: holds RatificationTokens minted by the
// Jason<->Muse instruction channel (see tokens.mjs). Tokens are looked up
// on EVERY evaluation -- expiry and revocation are never cached.
export function createTrustedChannelStore(initialTokens = []) {
  const tokens = new Map();

  function addToken(token) {
    if (!token || token.token_id == null) throw new Error("token requires token_id");
    tokens.set(token.token_id, { ...token });
    return tokens.get(token.token_id);
  }

  for (const token of initialTokens) addToken(token);

  return {
    // --- fixture-side write path (simulates the external channel) ---
    addToken,
    revokeToken(token_id) {
      const token = tokens.get(token_id);
      if (token) token.revoked = true;
      return token ?? null;
    },
    removeToken(token_id) {
      return tokens.delete(token_id);
    },
    // --- coordinator-side read path ---
    getToken(token_id) {
      return tokens.get(token_id) ?? null;
    },
    listTokens() {
      return [...tokens.values()];
    },
  };
}
