export const CONNECTION_CAPABILITY_KEYS = [
  "import_transactions",
  "import_balances",
  "import_invoices",
  "import_customers",
  "import_properties",
  "import_payouts",
  "export_data",
  "manual_sync",
  "scheduled_sync",
  "webhook_updates",
  "realtime_updates",
] as const;

export type ConnectionCapabilityKey =
  (typeof CONNECTION_CAPABILITY_KEYS)[number];

export type ConnectionCapabilities = Readonly<{
  connectionId: string;
  capabilities: readonly ConnectionCapabilityKey[];
  supportsAutomaticSync: boolean;
  supportsManualSync: boolean;
  supportsWebhooks: boolean;
  supportsRealtimeUpdates: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export function hasConnectionCapability(
  capabilities: ConnectionCapabilities,
  capability: ConnectionCapabilityKey,
): boolean {
  return capabilities.capabilities.includes(capability);
}
