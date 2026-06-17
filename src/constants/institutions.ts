export const DEFAULT_INSTITUTIONS = [
  {
    name: "Chase",
    type: "bank",
    supports_sync: true,
  },
  {
    name: "Bank of America",
    type: "bank",
    supports_sync: true,
  },
  {
    name: "Wells Fargo",
    type: "bank",
    supports_sync: true,
  },
  {
    name: "Capital One",
    type: "bank",
    supports_sync: true,
  },
  {
    name: "Fidelity",
    type: "brokerage",
    supports_sync: true,
  },
  {
    name: "Charles Schwab",
    type: "brokerage",
    supports_sync: true,
  },
  {
    name: "Vanguard",
    type: "brokerage",
    supports_sync: true,
  },
  {
    name: "Robinhood",
    type: "brokerage",
    supports_sync: true,
  },
  {
    name: "Coinbase",
    type: "crypto",
    supports_sync: true,
  },
  {
    name: "Kraken",
    type: "crypto",
    supports_sync: true,
  },
  {
    name: "Manual",
    type: "manual",
    supports_sync: false,
  },
] as const;