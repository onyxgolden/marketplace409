/**
 * ReportCalculator
 *
 * Base class for all financial report calculators.
 * Concrete implementations must override calculate().
 */

export class ReportCalculator {
  calculate() {
    throw new Error(
      "ReportCalculator subclasses must implement calculate()"
    );
  }
}
