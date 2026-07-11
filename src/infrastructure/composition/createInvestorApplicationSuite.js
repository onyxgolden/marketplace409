import {
  InvestorCashBuyerApplication,
  InvestorPropertyApplication,
  InvestorWholesalerApplication,
} from "../../application/index.js";

import { supabase } from "../../lib/supabase.js";
import { uploadImage } from "../../lib/uploadImage.js";

export function createInvestorApplicationSuite(deps = {}) {
  const investorSupabase =
    deps.supabase || supabase;

  const imageUploader =
    deps.imageUploader || uploadImage;

  const investorPropertyApplication =
    deps.investorPropertyApplication ||
    new InvestorPropertyApplication({
      supabase: investorSupabase,
      imageUploader,
    });

  const investorCashBuyerApplication =
    deps.investorCashBuyerApplication ||
    new InvestorCashBuyerApplication({
      supabase: investorSupabase,
    });

  const investorWholesalerApplication =
    deps.investorWholesalerApplication ||
    new InvestorWholesalerApplication({
      supabase: investorSupabase,
    });

  return Object.freeze({
    supabase: investorSupabase,
    imageUploader,
    investorPropertyApplication,
    investorCashBuyerApplication,
    investorWholesalerApplication,
  });
}

