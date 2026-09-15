// Market-data-specific capability keys, extending the exact pattern already established in
// src/domains/connection/connection-capabilities.types.ts (CONNECTION_CAPABILITY_KEYS) rather than
// inventing a new capability-negotiation shape. A market-data adapter (synthetic today, a licensed
// vendor in a future TR-1A) is a capability-negotiated provider like any other connection in this
// architecture -- see the architecture plan's §5.2, which reuses this same vocabulary for order-type
// support checks.

export const MARKET_DATA_CAPABILITY_KEYS = [
  "supports_quotes",
  "supports_bars",
  "supports_corporate_actions",
  "supports_adjusted_prices",
  "supports_real_time",
  "supports_delayed",
  "supports_end_of_day",
] as const;

export type MarketDataCapabilityKey = (typeof MARKET_DATA_CAPABILITY_KEYS)[number];

export type MarketDataCapabilities = Readonly<{
  adapterId: string;
  capabilities: readonly MarketDataCapabilityKey[];
}>;

export function hasMarketDataCapability(
  capabilities: MarketDataCapabilities,
  capability: MarketDataCapabilityKey,
): boolean {
  return capabilities.capabilities.includes(capability);
}
