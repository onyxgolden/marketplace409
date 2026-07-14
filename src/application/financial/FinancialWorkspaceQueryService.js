import {
  financialEventAggregationService,
} from "../../domains/financial-workspace/index.js";

/**
 * FinancialWorkspaceQueryService
 *
 * Application-layer orchestration for repository-backed financial workspace
 * queries. Repository access remains behind FinancialEventRepository while
 * financial calculations remain inside FinancialEventAggregationService.
 */
export class FinancialWorkspaceQueryService {
  constructor({
    financialEventRepository,
    aggregationService = financialEventAggregationService,
  } = {}) {
    if (!financialEventRepository) {
      throw new Error(
        "FinancialWorkspaceQueryService requires a financial event repository.",
      );
    }

    if (!aggregationService) {
      throw new Error(
        "FinancialWorkspaceQueryService requires an aggregation service.",
      );
    }

    if (
      typeof financialEventRepository.findByOwnerId !== "function"
    ) {
      throw new Error(
        "FinancialWorkspaceQueryService requires a repository with findByOwnerId.",
      );
    }

    if (typeof aggregationService.aggregate !== "function") {
      throw new Error(
        "FinancialWorkspaceQueryService requires an aggregation service with aggregate.",
      );
    }

    this.financialEventRepository = financialEventRepository;
    this.aggregationService = aggregationService;

    Object.freeze(this);
  }

  async buildWorkspace(ownerId) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    const events =
      await this.financialEventRepository.findByOwnerId(ownerId);

    return this.aggregationService.aggregate(events);
  }
}

Object.freeze(FinancialWorkspaceQueryService);
