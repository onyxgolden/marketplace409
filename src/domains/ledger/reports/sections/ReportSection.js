import { ReportLine } from "../ReportLine.js";

/**
 * ReportSection
 *
 * Immutable reusable section of a financial report.
 * Contains presentation-ready report lines only.
 * It does not calculate accounting.
 */

export class ReportSection {
  constructor({ name, lines = [] }) {
    if (!name || name.trim() === "") {
      throw new Error("ReportSection requires a name");
    }

    lines.forEach((line) => {
      if (!(line instanceof ReportLine)) {
        throw new Error("ReportSection lines must be ReportLine objects");
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
