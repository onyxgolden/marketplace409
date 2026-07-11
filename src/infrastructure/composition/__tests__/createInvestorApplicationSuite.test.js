import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

const {
  defaultSupabase,
  defaultImageUploader,
} = vi.hoisted(() => ({
  defaultSupabase: {},
  defaultImageUploader: vi.fn(),
}));

vi.mock("../../../lib/supabase.js", () => ({
  supabase: defaultSupabase,
}));

vi.mock("../../../lib/uploadImage.js", () => ({
  uploadImage: defaultImageUploader,
}));

import {
  InvestorCashBuyerApplication,
  InvestorPropertyApplication,
  InvestorWholesalerApplication,
} from "../../../application/index.js";

import {
  createInvestorApplicationSuite,
} from "../createInvestorApplicationSuite.js";

describe("createInvestorApplicationSuite", () => {
  it("builds the default investor application suite", () => {
    const suite = createInvestorApplicationSuite();

    expect(suite.supabase).toBe(defaultSupabase);
    expect(suite.imageUploader).toBe(defaultImageUploader);

    expect(suite.investorPropertyApplication).toBeInstanceOf(
      InvestorPropertyApplication,
    );

    expect(suite.investorCashBuyerApplication).toBeInstanceOf(
      InvestorCashBuyerApplication,
    );

    expect(suite.investorWholesalerApplication).toBeInstanceOf(
      InvestorWholesalerApplication,
    );

    expect(suite.investorPropertyApplication.supabase).toBe(
      suite.supabase,
    );

    expect(suite.investorPropertyApplication.imageUploader).toBe(
      suite.imageUploader,
    );

    expect(suite.investorCashBuyerApplication.supabase).toBe(
      suite.supabase,
    );

    expect(suite.investorWholesalerApplication.supabase).toBe(
      suite.supabase,
    );

    expect(Object.isFrozen(suite)).toBe(true);
  });

  it("injects shared infrastructure through every application", () => {
    const supabase = {};
    const imageUploader = vi.fn();

    const suite = createInvestorApplicationSuite({
      supabase,
      imageUploader,
    });

    expect(suite.supabase).toBe(supabase);
    expect(suite.imageUploader).toBe(imageUploader);

    expect(suite.investorPropertyApplication.supabase).toBe(
      supabase,
    );

    expect(suite.investorPropertyApplication.imageUploader).toBe(
      imageUploader,
    );

    expect(suite.investorCashBuyerApplication.supabase).toBe(
      supabase,
    );

    expect(suite.investorWholesalerApplication.supabase).toBe(
      supabase,
    );
  });

  it("allows every application to be injected", () => {
    const investorPropertyApplication = {};
    const investorCashBuyerApplication = {};
    const investorWholesalerApplication = {};

    const suite = createInvestorApplicationSuite({
      investorPropertyApplication,
      investorCashBuyerApplication,
      investorWholesalerApplication,
    });

    expect(suite.investorPropertyApplication).toBe(
      investorPropertyApplication,
    );

    expect(suite.investorCashBuyerApplication).toBe(
      investorCashBuyerApplication,
    );

    expect(suite.investorWholesalerApplication).toBe(
      investorWholesalerApplication,
    );
  });
});
