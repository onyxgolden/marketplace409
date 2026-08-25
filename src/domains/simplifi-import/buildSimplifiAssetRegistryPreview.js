const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const CRYPTO = /\b(bitcoin|btc|ethereum|eth|xrp|crypto|coinbase|digital asset)\b/i;
const VEHICLE = /\b(toyota|lexus|ford|chevrolet|chevy|gmc|dodge|ram|honda|nissan|vehicle|car|truck|suv|tacoma|gx\s?460|lx\s?600)\b/i;
const TRAILER = /\b(trailer|camper|rv|recreational vehicle|coleman)\b/i;
const EQUIPMENT = /\b(tractor|scag|turf|mower|ladder|tool|equipment|skid steer|excavator)\b/i;
const COLLECTIBLE = /\b(silver|gold|coin|collectible|bullion|art|memorabilia)\b/i;
const REAL_ESTATE = /\b(real estate|property|house|home|land|lot)\b/i;

export function inferSimplifiAssetClass(name) {
  if (CRYPTO.test(name)) return "crypto";
  if (TRAILER.test(name)) return "trailer";
  if (VEHICLE.test(name)) return "vehicle";
  if (EQUIPMENT.test(name)) return "equipment";
  if (COLLECTIBLE.test(name)) return "collectible";
  if (REAL_ESTATE.test(name)) return "real_estate";
  return null;
}

function inferredScope(accountId, scopeEvidence) {
  const scopes = new Set(
    (scopeEvidence ?? [])
      .filter((item) => item.financial_account_id === accountId)
      .map((item) => item.account_scope)
      .filter((scope) => scope === "business" || scope === "personal" || scope === "mixed"),
  );
  if (scopes.has("mixed") || (scopes.has("business") && scopes.has("personal"))) return "mixed";
  if (scopes.has("business")) return "business";
  if (scopes.has("personal")) return "personal";
  return null;
}

export function buildSimplifiAssetRegistryPreview({
  accounts = [], balances = [], existingAssets = [], scopeEvidence = [],
} = {}) {
  const balanceByAccount = new Map(balances.map((item) => [item.financial_account_id, item]));
  const existingNames = new Set(existingAssets.filter((item) => item.active !== false).map((item) => normalize(item.name)));

  const rows = accounts.filter((account) => account.active !== false).map((account) => {
    const assetClass = inferSimplifiAssetClass(account.name);
    const ownershipScope = inferredScope(account.id, scopeEvidence);
    const balance = balanceByAccount.get(account.id) ?? null;
    const base = {
      financialAccountId: account.id,
      name: account.name,
      provider: account.provider,
      accountType: account.type,
      assetClass,
      ownershipScope,
      valueCents: balance?.current_balance_cents ?? null,
      valueDate: balance?.as_of ?? null,
    };

    if (existingNames.has(normalize(account.name))) {
      return { ...base, classification: "already_registered", approvable: false, reason: "An active asset with this name already exists." };
    }
    if (assetClass === "real_estate") {
      return { ...base, classification: "excluded", approvable: false, reason: "Real estate remains authoritative in the property registry." };
    }
    if (!assetClass) {
      return { ...base, classification: "needs_review", approvable: false, reason: "Asset class requires review." };
    }
    if (assetClass !== "crypto" && account.type !== "other") {
      return { ...base, classification: "excluded", approvable: false, reason: "This financial-account type is not a registry asset." };
    }
    if (!ownershipScope || ownershipScope === "mixed") {
      return { ...base, classification: "needs_review", approvable: false, reason: "Ownership scope requires review." };
    }
    if (!balance || !Number.isInteger(balance.current_balance_cents) || balance.current_balance_cents < 0) {
      return { ...base, classification: "needs_review", approvable: false, reason: "A non-negative current value is required." };
    }
    return { ...base, classification: "ready", approvable: true, reason: "Ready for explicit asset-registry approval." };
  });

  const totals = rows.reduce((result, row) => {
    result[row.classification] = (result[row.classification] ?? 0) + 1;
    return result;
  }, {});
  return Object.freeze({ rows: Object.freeze(rows.map(Object.freeze)), totals: Object.freeze(totals) });
}
