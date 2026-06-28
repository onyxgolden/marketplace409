import { FinancialEventRepository } from "./FinancialEventRepository";

/**
 * InMemoryFinancialEventRepository
 *
 * In-memory implementation used for tests, local development,
 * and service-layer wiring before database persistence exists.
 */
export class InMemoryFinancialEventRepository extends FinancialEventRepository {
  constructor(events = []) {
    super();

    if (!Array.isArray(events)) {
      throw new Error("Financial events must be an array");
    }

    this._events = [...events];
  }

  saveMany(events) {
    if (!Array.isArray(events)) {
      throw new Error("Financial events must be an array");
    }

    this._events = [...this._events, ...events];

    return events;
  }

  findByOwnerId(ownerId) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    return this._events.filter((event) => event.owner_id === ownerId);
  }

  count() {
    return this._events.length;
  }
}
