import { ReportLine } from "../ReportLine";
import { ReportSection } from "../sections/ReportSection";

/**
 * ReportSectionBuilder
 *
 * Builds immutable report sections from presentation-ready report lines.
 * This builder does not calculate accounting.
 */

export class ReportSectionBuilder {
  build({ name, lines = [] }) {
    lines.forEach((line) => {
      if (!(line instanceof ReportLine)) {
        throw new Error(
          "ReportSectionBuilder lines must be ReportLine objects"
        );
      }
    });

    return new ReportSection({ name, lines });
  }
}
