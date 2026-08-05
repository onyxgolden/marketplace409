/**
 * TransactionReviewQueryService
 *
 * Application-layer orchestration for owner-scoped transaction-review
 * queries. Repository access remains behind FinancialEventRepository while
 * review-queue projection remains behind an injected domain service.
 */
export class TransactionReviewQueryService {
  constructor({
    financialEventRepository,
    projectionService,
  } = {}) {
    if (!financialEventRepository) {
      throw new Error(
        "TransactionReviewQueryService requires a financial event repository.",
      );
    }

    if (
      typeof financialEventRepository.findByOwnerId !== "function"
    ) {
      throw new Error(
        "TransactionReviewQueryService requires a repository with findByOwnerId.",
      );
    }

    if (!projectionService) {
      throw new Error(
        "TransactionReviewQueryService requires a projection service.",
      );
    }

    if (typeof projectionService.project !== "function") {
      throw new Error(
        "TransactionReviewQueryService requires a projection service with project.",
      );
    }

    this.financialEventRepository = financialEventRepository;
    this.projectionService = projectionService;

    Object.freeze(this);
  }

  async buildReviewQueue(ownerId) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    const events =
      await this.financialEventRepository.findByOwnerId(ownerId);

    return this.projectionService.project(events);
  }
}

Object.freeze(TransactionReviewQueryService);
