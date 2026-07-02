export type PlaidEnvironment = "sandbox" | "development" | "production";

export type PlaidConfig = {
  environment: PlaidEnvironment;
  clientId: string;
  secret: string;
};

export function getPlaidConfig(): PlaidConfig {
  const environment = parsePlaidEnvironment(process.env.PLAID_ENV);
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;

  if (!clientId) {
    throw new Error("PLAID_CLIENT_ID is required.");
  }

  if (!secret) {
    throw new Error("PLAID_SECRET is required.");
  }

  return {
    environment,
    clientId,
    secret,
  };
}

function parsePlaidEnvironment(
  value: string | undefined,
): PlaidEnvironment {
  if (value === "development" || value === "production") {
    return value;
  }

  return "sandbox";
}
