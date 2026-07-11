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
  AdminAuthorizationApplication,
  BusinessClaimApplication,
  BusinessCreateApplication,
  BusinessDeleteApplication,
  BusinessEditApplication,
} from "../../../application/index.js";

import { BusinessClaimRepository } from "../../../domains/business-claims/business-claim.repository";
import { BusinessClaimService } from "../../../domains/business-claims/business-claim.service";

import {
  createBusinessApplicationSuite,
} from "../createBusinessApplicationSuite.js";

describe("createBusinessApplicationSuite", () => {
  it("builds the default business application suite", () => {
    const suite = createBusinessApplicationSuite();

    expect(suite.supabase).toBe(defaultSupabase);
    expect(suite.imageUploader).toBe(defaultImageUploader);

    expect(suite.businessClaimRepository).toBeInstanceOf(
      BusinessClaimRepository,
    );

    expect(suite.businessClaimService).toBeInstanceOf(
      BusinessClaimService,
    );

    expect(suite.adminAuthorizationApplication).toBeInstanceOf(
      AdminAuthorizationApplication,
    );

    expect(suite.businessCreateApplication).toBeInstanceOf(
      BusinessCreateApplication,
    );

    expect(suite.businessEditApplication).toBeInstanceOf(
      BusinessEditApplication,
    );

    expect(suite.businessDeleteApplication).toBeInstanceOf(
      BusinessDeleteApplication,
    );

    expect(suite.businessClaimApplication).toBeInstanceOf(
      BusinessClaimApplication,
    );

    expect(suite.adminAuthorizationApplication.supabase).toBe(
      suite.supabase,
    );

    expect(suite.businessCreateApplication.supabase).toBe(
      suite.supabase,
    );

    expect(suite.businessEditApplication.supabase).toBe(
      suite.supabase,
    );

    expect(suite.businessEditApplication.imageUploader).toBe(
      suite.imageUploader,
    );

    expect(suite.businessDeleteApplication.supabase).toBe(
      suite.supabase,
    );

    expect(suite.businessClaimService.repo).toBe(
      suite.businessClaimRepository,
    );

    expect(suite.businessClaimApplication.service).toBe(
      suite.businessClaimService,
    );

    expect(Object.isFrozen(suite)).toBe(true);
  });

  it("injects shared infrastructure through every application", () => {
    const supabase = {};
    const imageUploader = vi.fn();

    const suite = createBusinessApplicationSuite({
      supabase,
      imageUploader,
    });

    expect(suite.supabase).toBe(supabase);
    expect(suite.imageUploader).toBe(imageUploader);

    expect(suite.adminAuthorizationApplication.supabase).toBe(
      supabase,
    );

    expect(suite.businessCreateApplication.supabase).toBe(
      supabase,
    );

    expect(suite.businessEditApplication.supabase).toBe(
      supabase,
    );

    expect(suite.businessEditApplication.imageUploader).toBe(
      imageUploader,
    );

    expect(suite.businessDeleteApplication.supabase).toBe(
      supabase,
    );
  });

  it("allows every dependency and application to be injected", () => {
    const businessClaimRepository = {};
    const businessClaimService = {};
    const adminAuthorizationApplication = {};
    const businessCreateApplication = {};
    const businessEditApplication = {};
    const businessDeleteApplication = {};
    const businessClaimApplication = {};

    const suite = createBusinessApplicationSuite({
      businessClaimRepository,
      businessClaimService,
      adminAuthorizationApplication,
      businessCreateApplication,
      businessEditApplication,
      businessDeleteApplication,
      businessClaimApplication,
    });

    expect(suite.businessClaimRepository).toBe(
      businessClaimRepository,
    );

    expect(suite.businessClaimService).toBe(
      businessClaimService,
    );

    expect(suite.adminAuthorizationApplication).toBe(
      adminAuthorizationApplication,
    );

    expect(suite.businessCreateApplication).toBe(
      businessCreateApplication,
    );

    expect(suite.businessEditApplication).toBe(
      businessEditApplication,
    );

    expect(suite.businessDeleteApplication).toBe(
      businessDeleteApplication,
    );

    expect(suite.businessClaimApplication).toBe(
      businessClaimApplication,
    );
  });
});
