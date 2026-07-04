/**
 * AccountingPeriodRepository
 *
 * Domain repository contract.
 * Infrastructure implementations (Supabase, Postgres, etc.)
 * must implement this interface.
 */
export class AccountingPeriodRepository {
  findById(_id) {
    throw new Error("Not implemented");
  }

  save(_period) {
    throw new Error("Not implemented");
  }
}
