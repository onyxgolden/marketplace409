export type DecisionStatus =
  | "open"
  | "accepted"
  | "rejected"
  | "completed";

export type DecisionPriority =
  | "low"
  | "medium"
  | "high"
  | "urgent";

export type DecisionInput = Readonly<{
  id: string;
  context: unknown;
  recommendation: unknown;
  confidence: number;
  priority: DecisionPriority;
  status?: DecisionStatus;
  selectedAction?: unknown;
  outcome?: unknown;
}>;

const VALID_STATUSES = new Set<DecisionStatus>([
  "open",
  "accepted",
  "rejected",
  "completed",
]);

const VALID_PRIORITIES = new Set<DecisionPriority>([
  "low",
  "medium",
  "high",
  "urgent",
]);

export class Decision {
  readonly id: string;
  readonly context: unknown;
  readonly recommendation: unknown;
  readonly confidence: number;
  readonly priority: DecisionPriority;
  readonly status: DecisionStatus;
  readonly selectedAction: unknown;
  readonly outcome: unknown;

  constructor({
    id,
    context,
    recommendation,
    confidence,
    priority,
    status = "open",
    selectedAction = null,
    outcome = null,
  }: DecisionInput) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Decision id must be a non-empty string");
    }

    if (typeof confidence !== "number" || Number.isNaN(confidence)) {
      throw new Error("Decision confidence must be a number");
    }

    if (!VALID_PRIORITIES.has(priority)) {
      throw new Error("Decision priority must be valid");
    }

    if (!VALID_STATUSES.has(status)) {
      throw new Error("Decision status must be valid");
    }

    this.id = id;
    this.context = context;
    this.recommendation = recommendation;
    this.confidence = confidence;
    this.priority = priority;
    this.status = status;
    this.selectedAction = selectedAction;
    this.outcome = outcome;

    Object.freeze(this);
  }

  toJSON() {
    return {
      id: this.id,
      context: this.context,
      recommendation: this.recommendation,
      confidence: this.confidence,
      priority: this.priority,
      status: this.status,
      selectedAction: this.selectedAction,
      outcome: this.outcome,
    };
  }
}
