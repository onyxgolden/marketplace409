import {
  AdminAuthorizationApplication,
  BusinessClaimApplication,
  BusinessCreateApplication,
  BusinessDeleteApplication,
  BusinessEditApplication,
} from "../../application/index.js";

import { BusinessClaimRepository } from "../../domains/business-claims/business-claim.repository";
import { BusinessClaimService } from "../../domains/business-claims/business-claim.service";

import { supabase } from "../../lib/supabase.js";
import { uploadImage } from "../../lib/uploadImage.js";

export function createBusinessApplicationSuite(deps = {}) {
  const businessSupabase =
    deps.supabase || supabase;

  const imageUploader =
    deps.imageUploader || uploadImage;

  const businessClaimRepository =
    deps.businessClaimRepository ||
    new BusinessClaimRepository();

  const businessClaimService =
    deps.businessClaimService ||
    new BusinessClaimService(
      businessClaimRepository,
    );

  const adminAuthorizationApplication =
    deps.adminAuthorizationApplication ||
    new AdminAuthorizationApplication({
      supabase: businessSupabase,
    });

  const businessCreateApplication =
    deps.businessCreateApplication ||
    new BusinessCreateApplication({
      supabase: businessSupabase,
    });

  const businessEditApplication =
    deps.businessEditApplication ||
    new BusinessEditApplication({
      supabase: businessSupabase,
      imageUploader,
    });

  const businessDeleteApplication =
    deps.businessDeleteApplication ||
    new BusinessDeleteApplication({
      supabase: businessSupabase,
    });

  const businessClaimApplication =
    deps.businessClaimApplication ||
    new BusinessClaimApplication({
      service: businessClaimService,
    });

  return Object.freeze({
    supabase: businessSupabase,
    imageUploader,
    businessClaimRepository,
    businessClaimService,
    adminAuthorizationApplication,
    businessCreateApplication,
    businessEditApplication,
    businessDeleteApplication,
    businessClaimApplication,
  });
}
