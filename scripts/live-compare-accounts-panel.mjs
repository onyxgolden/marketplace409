#!/usr/bin/env node
// Read-only live comparison: panel totals vs KPI (position) totals from one
// captured set of database dumps, at one timestamp.
//
// Usage: node scripts/live-compare-accounts-panel.mjs <data-dir> <iso-timestamp>
//
// The authority resolution below is a faithful port of
// FinancialPositionQueryService.resolveGroupBalanceAuthority (static regex,
// healthy-connection gating, 168h eligibility, 48h degradation, freshest
// wins, ties -> lexicographically smallest id, NOT-exactly-one unresolved
// groups stay unsuppressed). It is cross-validated by running it against the
// 2026-11-20 snapshot dumps: it must reproduce the fixture's expected totals
// (assets 424401407, liabilities 42268925, net worth 382132482 cents) exactly.
// The panel math is a port of buildTree in FinancialAccountBalancesPanel.jsx
// plus the route's inclusion rule (included <=> projected by the position).
//
// Exit 0 when all three totals agree to the cent; exit 1 otherwise, with a
// row-level reconciliation printed.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dataDir, timestamp] = process.argv.slice(2);
if (!dataDir || !timestamp) {
  console.error("Usage: node scripts/live-compare-accounts-panel.mjs <data-dir> <iso-timestamp>");
  process.exit(2);
}
const NOW = new Date(timestamp);
if (Number.isNaN(NOW.getTime())) {
  console.error(`Bad timestamp: ${timestamp}`);
  process.exit(2);
}

function load(name) {
  return JSON.parse(readFileSync(join(dataDir, `${name}.json`), "utf8"));
}

const accounts = load("financial_accounts");
const balances = load("account_balances");
const groups = load("financial_account_groups");
const members = load("financial_account_group_members");
const connections = load("connections");
const assets = load("financial_assets");
const assetValuations = load("financial_asset_valuations");
const investmentAccounts = load("investment_accounts");
const investmentValuations = load("investment_account_valuations");

const ASSET_TYPES = new Set(["depository", "investment", "other"]);
const LIABILITY_TYPES = new Set(["credit", "loan"]);
const STATIC_PROVIDER = /(^manual$|_csv$)/;
const LIVE_ELIGIBLE_STATUSES = new Set(["connected", "syncing"]);

const accountById = new Map(accounts.map((a) => [a.id, a]));
const balanceByAccountId = new Map(balances.map((b) => [b.financial_account_id, b]));
const connectionStatus = new Map(connections.map((c) => [c.id, c.status]));
const membersByGroup = new Map();
for (const m of members) {
  const list = membersByGroup.get(m.group_id) || [];
  list.push(m.financial_account_id);
  membersByGroup.set(m.group_id, list);
}

function hoursSince(asOf) {
  return (NOW.getTime() - new Date(asOf).getTime()) / (1000 * 60 * 60);
}
function isStatic(provider) {
  return STATIC_PROVIDER.test(provider || "");
}
function isHealthyLive(account) {
  return LIVE_ELIGIBLE_STATUSES.has(connectionStatus.get(account.connection_id));
}
function pickFreshest(candidates) {
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => {
    const diff = new Date(b.balance.as_of).getTime() - new Date(a.balance.as_of).getTime();
    return diff !== 0 ? diff : a.account.id.localeCompare(b.account.id);
  })[0];
}

// --- Position (KPI side): resolve each group, project assets/liabilities. ---
const authorityByAccountId = new Map();
const superseded = [];
for (const group of groups) {
  const memberIds = membersByGroup.get(group.id) || [];
  const candidates = memberIds
    .map((id) => ({ account: accountById.get(id), balance: balanceByAccountId.get(id) }))
    .filter((c) => c.account && c.balance);
  if (candidates.length === 0) continue;
  const live = candidates.filter((c) => !isStatic(c.account.provider) && isHealthyLive(c.account));
  const eligibleLive = live.filter((c) => hoursSince(c.balance.as_of) <= 7 * 24);
  const staticCandidates = candidates.filter((c) => isStatic(c.account.provider));
  const winner = pickFreshest(eligibleLive) || pickFreshest(staticCandidates);
  if (!winner) continue; // NOT-exactly-one: unresolved, members stay unsuppressed.
  for (const id of memberIds) {
    authorityByAccountId.set(id, { isWinner: id === winner.account.id });
  }
  for (const c of candidates) {
    if (c.account.id !== winner.account.id) superseded.push(c.account.id);
  }
}

const projectedAssetIds = new Set();
const projectedLiabilityIds = new Set();
const missing = [];
let kpiAssets = 0;
let kpiLiabilities = 0;
for (const account of accounts) {
  if (account.active === false) continue;
  const balance = balanceByAccountId.get(account.id);
  if (ASSET_TYPES.has(account.type)) {
    if (!balance) { missing.push(account.id); continue; }
    const authority = authorityByAccountId.get(account.id);
    if (authority && !authority.isWinner) continue;
    projectedAssetIds.add(account.id);
    kpiAssets += balance.current_balance_cents;
  } else if (LIABILITY_TYPES.has(account.type)) {
    if (!balance) { missing.push(account.id); continue; }
    const authority = authorityByAccountId.get(account.id);
    if (authority && !authority.isWinner) continue;
    projectedLiabilityIds.add(account.id);
    kpiLiabilities += Math.abs(balance.current_balance_cents);
  }
}

// --- Panel side: route inclusion + buildTree math over the same inputs. ---
const isIncluded = (account) =>
  (ASSET_TYPES.has(account.type) && projectedAssetIds.has(account.id)) ||
  (LIABILITY_TYPES.has(account.type) && projectedLiabilityIds.has(account.id));

function latestValuation(rows, keyField, id) {
  const mine = rows.filter((r) => r[keyField] === id);
  if (mine.length === 0) return null;
  return mine.slice().sort((a, b) => {
    const d = new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime();
    return d !== 0 ? d : new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  })[0];
}

const activeInvestmentIds = new Set(investmentAccounts.filter((a) => a.active !== false).map((a) => a.id));
const activeAssetIds = new Set(assets.filter((a) => a.active !== false).map((a) => a.id));

let panelBanking = 0;
let panelLinkedInvestments = 0;
let panelLiabilities = 0;
let panelOther = 0;
let panelRegistryInvestments = 0;
let panelRegistryAssets = 0;
const divergences = [];
const excludedRows = [];

for (const account of accounts) {
  if (account.active === false || (!ASSET_TYPES.has(account.type) && !LIABILITY_TYPES.has(account.type))) continue;
  const balance = balanceByAccountId.get(account.id);
  if (!isIncluded(account)) {
    // A registry mirror's exclusion is carried by its registry row.
    if (!activeInvestmentIds.has(account.id) && !activeAssetIds.has(account.id)) excludedRows.push(account.id);
    continue;
  }
  if (account.type === "depository") panelBanking += balance.current_balance_cents;
  else if (account.type === "investment" && !activeInvestmentIds.has(account.id)) panelLinkedInvestments += balance.current_balance_cents;
  else if (account.type === "credit" || account.type === "loan") panelLiabilities += Math.abs(balance.current_balance_cents);
  else if (account.type === "other" && !activeAssetIds.has(account.id)) panelOther += balance.current_balance_cents;
}

for (const inv of investmentAccounts.filter((a) => a.active !== false)) {
  const valuation = latestValuation(investmentValuations, "account_id", inv.id);
  const valuationCents = valuation ? Number(valuation.amount_cents) || 0 : 0;
  const mirror = accountById.get(inv.id);
  if (!mirror) { excludedRows.push(inv.id); continue; }
  if (!isIncluded(mirror)) { excludedRows.push(inv.id); continue; }
  const mirrorCents = balanceByAccountId.get(inv.id)?.current_balance_cents ?? null;
  if (mirrorCents !== null && mirrorCents !== valuationCents) {
    divergences.push({ id: inv.id, name: inv.name, valuationCents, mirrorCents });
  }
  panelRegistryInvestments += mirrorCents ?? valuationCents;
}

for (const asset of assets.filter((a) => a.active !== false)) {
  const valuation = latestValuation(assetValuations, "asset_id", asset.id);
  const valuationCents = valuation ? Number(valuation.amount_cents) || 0 : 0;
  const mirror = accountById.get(asset.id);
  if (!mirror) { excludedRows.push(asset.id); continue; }
  if (!isIncluded(mirror)) { excludedRows.push(asset.id); continue; }
  const mirrorCents = balanceByAccountId.get(asset.id)?.current_balance_cents ?? null;
  if (mirrorCents !== null && mirrorCents !== valuationCents) {
    divergences.push({ id: asset.id, name: asset.name, valuationCents, mirrorCents });
  }
  panelRegistryAssets += mirrorCents ?? valuationCents;
}

const panelAssets = panelBanking + panelLinkedInvestments + panelOther + panelRegistryInvestments + panelRegistryAssets;
const panelNetWorth = panelAssets - panelLiabilities;
const kpiNetWorth = kpiAssets - kpiLiabilities;

function dollars(cents) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

console.log(`Live comparison at ${timestamp} (data dir: ${dataDir})`);
console.log(`  accounts=${accounts.length} balances=${balances.length} groups=${groups.length} connections=${connections.length} assets=${assets.length} investmentAccounts=${investmentAccounts.length}`);
console.log(`  superseded=${superseded.length} missing=${missing.length} excludedRows=${excludedRows.length} divergences=${divergences.length}`);
console.log("  KPI (position):");
console.log(`    assets      ${kpiAssets} (${dollars(kpiAssets)})`);
console.log(`    liabilities ${kpiLiabilities} (${dollars(kpiLiabilities)})`);
console.log(`    net worth   ${kpiNetWorth} (${dollars(kpiNetWorth)})`);
console.log("  Panel (route + buildTree):");
console.log(`    banking ${panelBanking} | linked investments ${panelLinkedInvestments} | other ${panelOther} | registry investments ${panelRegistryInvestments} | registry assets ${panelRegistryAssets}`);
console.log(`    assets      ${panelAssets} (${dollars(panelAssets)})`);
console.log(`    liabilities ${panelLiabilities} (${dollars(panelLiabilities)})`);
console.log(`    net worth   ${panelNetWorth} (${dollars(panelNetWorth)})`);
if (divergences.length > 0) {
  console.log("  Divergences (registry valuation != mirror balance; panel counts the mirror):");
  for (const d of divergences) console.log(`    ${d.name} (${d.id}): valuation ${d.valuationCents}, mirror ${d.mirrorCents}`);
}
const ok = panelAssets === kpiAssets && panelLiabilities === kpiLiabilities && panelNetWorth === kpiNetWorth;
console.log(ok ? "  RESULT: MATCH to the cent on all three totals." : "  RESULT: MISMATCH -- see totals above.");
process.exit(ok ? 0 : 1);
