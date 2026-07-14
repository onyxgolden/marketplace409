import type { Property } from "../property/property.types";
import type { Transaction } from "../transaction/transaction.types";

export type PropertyRecommendation = Readonly<{
  property: Property;
  score: number;
  explanation: string;
}>;

export type PropertyRecommendationResult = Readonly<{
  recommendations: readonly PropertyRecommendation[];
  suggestedProperties: readonly Property[];
  confidence: number;
}>;

export type PropertyRecommendationInput = Readonly<{
  transaction: Transaction;
  properties: readonly Property[];
  limit?: number;
}>;

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

function transactionSearchText(transaction: Transaction): string {
  const rawValues = Object.values(transaction.raw ?? {})
    .filter(
      (value) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    )
    .map((value) => String(value));

  return normalize(
    [
      transaction.description,
      transaction.merchantName,
      ...transaction.category,
      ...rawValues,
    ].join(" "),
  );
}

function propertyLabel(property: Property): string {
  return (
    property.name ??
    property.address ??
    property.sourceName ??
    property.id
  );
}

function scoreProperty(
  transactionText: string,
  property: Property,
): PropertyRecommendation | null {
  const matches: Array<{
    score: number;
    explanation: string;
  }> = [];

  const address = normalize(property.address);

  if (address.length >= 5 && transactionText.includes(address)) {
    matches.push({
      score: 1,
      explanation: "Transaction context contains the property address.",
    });
  }

  const name = normalize(property.name);

  if (name.length >= 3 && transactionText.includes(name)) {
    matches.push({
      score: 0.9,
      explanation: "Transaction context contains the property name.",
    });
  }

  const sourceName = normalize(property.sourceName);

  if (
    sourceName.length >= 3 &&
    sourceName !== name &&
    transactionText.includes(sourceName)
  ) {
    matches.push({
      score: 0.85,
      explanation: "Transaction context contains the source property name.",
    });
  }

  const city = normalize(property.city);

  if (city.length >= 3 && transactionText.includes(city)) {
    matches.push({
      score: 0.35,
      explanation: "Transaction context contains the property city.",
    });
  }

  if (matches.length === 0) {
    return null;
  }

  const strongestMatch = [...matches].sort(
    (left, right) => right.score - left.score,
  )[0];

  const combinedScore = Math.min(
    1,
    matches.reduce((total, match) => total + match.score, 0),
  );

  return Object.freeze({
    property,
    score: combinedScore,
    explanation: strongestMatch.explanation,
  });
}

export class PropertyRecommendationService {
  recommend({
    transaction,
    properties,
    limit = 3,
  }: PropertyRecommendationInput): PropertyRecommendationResult {
    if (!Array.isArray(properties)) {
      throw new Error(
        "PropertyRecommendationService properties must be an array",
      );
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(
        "PropertyRecommendationService limit must be a positive integer",
      );
    }

    const transactionText = transactionSearchText(transaction);

    const recommendations = properties
      .map((property) => scoreProperty(transactionText, property))
      .filter(
        (
          recommendation,
        ): recommendation is PropertyRecommendation =>
          recommendation !== null,
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          propertyLabel(left.property).localeCompare(
            propertyLabel(right.property),
          ),
      )
      .slice(0, limit);

    const immutableRecommendations = Object.freeze([
      ...recommendations,
    ]);

    return Object.freeze({
      recommendations: immutableRecommendations,
      suggestedProperties: Object.freeze(
        immutableRecommendations.map(
          (recommendation) => recommendation.property,
        ),
      ),
      confidence: immutableRecommendations[0]?.score ?? 0,
    });
  }
}
