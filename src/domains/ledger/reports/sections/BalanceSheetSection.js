import { ReportLine } from "../ReportLine";

/**
 * BalanceSheetSection
 *
 * Immutable section of a balance sheet.
 * Contains presentation-ready report lines only.
 * It does not calculate accounting.
 */

export class BalanceSheetSection {
  constructor({ name, lines = [] }) {
    if (!name || name.trim() === "") {
      throw new Error("BalanceSheetSection requires a name");
    }

    lines.forEach((line) => {
      if (!(line instanceof ReportLine)) {
        throw new Error(
          "BalanceSheetSection lines must be ReportLine objects"
        );
      }
    });

    this.name = name;
    this._lines = Object.freeze([...lines]);

    Object.freeze(this);
  }

  lines() {
    return this._lines;
  }
}
