import type {
  ConnectionCapabilities,
  ConnectionCapabilityKey,
} from "./connection-capabilities.types";

import {
  hasConnectionCapability,
} from "./connection-capabilities.types";

import type {
  ConnectionProvider,
  ConnectionProviderHealth,
} from "./connection-provider.types";

export type ConnectionProviderRegistry = Readonly<{
  providers: readonly ConnectionProvider[];
  totalProviders: number;
  providerNames: readonly string[];
}>;

export function createConnectionProviderRegistry(
  providers: readonly ConnectionProvider[],
): ConnectionProviderRegistry {
  const providerNames = providers.map((provider) => provider.provider);
  const uniqueProviderNames = new Set(providerNames);

  if (uniqueProviderNames.size !== providerNames.length) {
    throw new Error("ConnectionProviderRegistry cannot contain duplicate providers.");
  }

  return {
    providers: [...providers],
    totalProviders: providers.length,
    providerNames,
  };
}

export function findConnectionProvider(
  registry: ConnectionProviderRegistry,
  providerName: string,
): ConnectionProvider | null {
  return registry.providers.find(
    (provider) => provider.provider === providerName,
  ) ?? null;
}

export function hasConnectionProvider(
  registry: ConnectionProviderRegistry,
  providerName: string,
): boolean {
  return findConnectionProvider(registry, providerName) !== null;
}

export function providersSupportingCapability(
  registry: ConnectionProviderRegistry,
  capability: ConnectionCapabilityKey,
): readonly ConnectionProvider[] {
  return registry.providers.filter((provider) => {
    const capabilities: ConnectionCapabilities = provider.capabilities();

    return hasConnectionCapability(capabilities, capability);
  });
}

export async function connectionProviderHealthReport(
  registry: ConnectionProviderRegistry,
): Promise<readonly ConnectionProviderHealth[]> {
  return Promise.all(
    registry.providers.map((provider) => provider.providerHealth()),
  );
}
