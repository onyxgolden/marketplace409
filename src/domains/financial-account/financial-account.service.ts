import type {
  FinancialAccountRepository,
} from "./financial-account.repository";

import type {
  FinancialAccount,
} from "./financial-account.types";

export class FinancialAccountService {
  private readonly repository: FinancialAccountRepository;

  constructor(repository: FinancialAccountRepository) {
    this.repository = repository;
  }

  async findByConnection(
    connectionId: string,
  ): Promise<readonly FinancialAccount[]> {
    return this.repository.findByConnection(connectionId);
  }
}
