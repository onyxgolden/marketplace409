import { financialEventFactory } from "./financial-event.factory";
import { FinancialEventTranslator } from "./FinancialEventTranslator";

export class FinancialEventGateway {
  constructor(factory = financialEventFactory, ownerId = null) {
    this.factory = factory;
    this.ownerId = ownerId;

    Object.freeze(this);
  }

  create(record) {
    if (!record) throw new Error("Missing resolved record");
    if (!record.date) throw new Error("Missing date");
    if (!record.description) throw new Error("Missing description");
    if (record.amount == null) throw new Error("Missing amount");
    if (!record.knowledge) throw new Error("Missing knowledge");

    const event = this.factory.fromResolvedInput(record, this.ownerId);

    FinancialEventTranslator.validate(event);

    return event;
  }
}
