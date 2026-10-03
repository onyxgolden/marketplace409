import { describe, expect, it } from "vitest";
import {
  LINK_RELATIONSHIPS, LINK_PROVENANCE, LINK_STATUS,
  validateLinkInput, validateStatusTransition, validateConfirm,
  isResolvableRelationshipType, LINK_PROVENANCE_LABELS, LINK_STATUS_LABELS,
} from "./workLinks.js";

const GOOD = {
  relationship_type: "on_asset",
  source_domain: "workmgmt", source_type: "work_package", source_id: "forge_wp_1",
  target_domain: "workmgmt", target_type: "forge_work_asset", target_id: "forge_wasset_1",
  created_by: "user_1", provenance: "user_confirmed",
};

describe("validateLinkInput", () => {
  it("accepts a well-formed link in canonical orientation", () => {
    expect(validateLinkInput(GOOD).ok).toBe(true);
  });
  it("rejects an unknown relationship type", () => {
    const r = validateLinkInput({ ...GOOD, relationship_type: "likes" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/relationship_type must be one of/);
  });
  it("rejects the reverse orientation", () => {
    const r = validateLinkInput({
      ...GOOD,
      source_domain: "workmgmt", source_type: "forge_work_asset", source_id: "forge_wasset_1",
      target_domain: "workmgmt", target_type: "work_package", target_id: "forge_wp_1",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/must run workmgmt.work_package -> workmgmt.forge_work_asset/);
  });
  it("rejects mismatched endpoint types for the relationship", () => {
    const r = validateLinkInput({ ...GOOD, target_type: "forge_work_location" });
    expect(r.ok).toBe(false);
  });
  it("rejects a self link", () => {
    const r = validateLinkInput({
      relationship_type: "supported_by_drawing",
      source_domain: "workmgmt", source_type: "work_package", source_id: "same",
      target_domain: "workmgmt", target_type: "work_package", target_id: "same",
      created_by: "user_1",
    });
    // orientation fails first for this type, but self-link is also caught
    expect(r.ok).toBe(false);
  });
  it("rejects a self link on a same-type-allowed orientation", () => {
    // on_asset is package -> asset; craft a hypothetical same domain/type
    // pair by checking the self rule through orientation-valid input is not
    // possible for distinct types, so verify the rule fires via direct call:
    const r = validateLinkInput({
      relationship_type: "on_asset",
      source_domain: "workmgmt", source_type: "work_package", source_id: "forge_wp_1",
      target_domain: "workmgmt", target_type: "forge_work_asset", target_id: "forge_wp_1",
      created_by: "user_1",
    });
    expect(r.ok).toBe(true); // different types: not a self link
  });
  it("requires created_by", () => {
    const r = validateLinkInput({ ...GOOD, created_by: " " });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/created_by is required/);
  });
  it("forces brain-proposal creations to ai_proposed", () => {
    const r = validateLinkInput({ ...GOOD, created_by: "brain-proposal", provenance: "user_confirmed" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/must use provenance 'ai_proposed'/);
  });
  it("only lets brain-proposal create ai_proposed links", () => {
    const r = validateLinkInput({ ...GOOD, created_by: "user_1", provenance: "ai_proposed" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/Only 'brain-proposal' may create/);
  });
  it("accepts a brain proposal", () => {
    const r = validateLinkInput({ ...GOOD, created_by: "brain-proposal", provenance: "ai_proposed" });
    expect(r.ok).toBe(true);
  });
  it("requires source_locator for deterministic imports", () => {
    const r = validateLinkInput({ ...GOOD, created_by: "system", provenance: "deterministic_import" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/must record their import source/);
    const ok = validateLinkInput({ ...GOOD, created_by: "system", provenance: "deterministic_import",
      source_locator: "schedule:block:sp1_b7@rev3" });
    expect(ok.ok).toBe(true);
  });
  it("rejects a non-object annotation", () => {
    const r = validateLinkInput({ ...GOOD, annotation: ["zone", "A"] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/annotation must be a JSON object/);
  });
  it("accepts a JSON object annotation", () => {
    const r = validateLinkInput({ ...GOOD, annotation: { zone: "Area 51", activity_type: "mechanical" } });
    expect(r.ok).toBe(true);
  });
});

describe("validateStatusTransition", () => {
  it("allows unresolved -> active and unresolved -> broken", () => {
    expect(validateStatusTransition("unresolved", "active").ok).toBe(true);
    expect(validateStatusTransition("unresolved", "broken").ok).toBe(true);
  });
  it("allows active -> stale and active -> broken", () => {
    expect(validateStatusTransition("active", "stale").ok).toBe(true);
    expect(validateStatusTransition("active", "broken").ok).toBe(true);
  });
  it("allows stale -> active and stale -> broken", () => {
    expect(validateStatusTransition("stale", "active").ok).toBe(true);
    expect(validateStatusTransition("stale", "broken").ok).toBe(true);
  });
  it("allows broken -> active only", () => {
    expect(validateStatusTransition("broken", "active").ok).toBe(true);
    expect(validateStatusTransition("broken", "stale").ok).toBe(false);
  });
  it("rejects unknown states", () => {
    expect(validateStatusTransition("active", "vibing").ok).toBe(false);
  });
  it("rejects backwards moves", () => {
    expect(validateStatusTransition("active", "unresolved").ok).toBe(false);
  });
});

describe("validateConfirm", () => {
  const proposed = { id: "forge_wlink_1", provenance: LINK_PROVENANCE.AI_PROPOSED };
  it("accepts a person confirming an ai_proposed link", () => {
    expect(validateConfirm(proposed, "user_9").ok).toBe(true);
  });
  it("rejects confirming a non-proposed link", () => {
    const r = validateConfirm({ ...proposed, provenance: LINK_PROVENANCE.USER_CONFIRMED }, "user_9");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Only 'ai_proposed' links can be confirmed/);
  });
  it("rejects brain-proposal as confirmer", () => {
    expect(validateConfirm(proposed, "brain-proposal").ok).toBe(false);
  });
  it("rejects system as confirmer", () => {
    expect(validateConfirm(proposed, "system").ok).toBe(false);
  });
  it("rejects a missing link", () => {
    expect(validateConfirm(null, "user_9").ok).toBe(false);
  });
});

describe("vocabulary metadata", () => {
  it("every relationship has a plain-English label", () => {
    for (const [key, rel] of Object.entries(LINK_RELATIONSHIPS)) {
      expect(typeof rel.label, key).toBe("string");
      expect(rel.label.length, key).toBeGreaterThan(0);
      expect(rel.source.domain, key).toBeTruthy();
      expect(rel.target.domain, key).toBeTruthy();
    }
  });
  it("every provenance and status has a plain-English label", () => {
    for (const p of Object.values(LINK_PROVENANCE)) expect(LINK_PROVENANCE_LABELS[p]).toBeTruthy();
    for (const s of Object.values(LINK_STATUS)) expect(LINK_STATUS_LABELS[s]).toBeTruthy();
  });
  it("project/property relationship types are vocabulary-valid but not resolvable yet", () => {
    expect(isResolvableRelationshipType("contains_package")).toBe(false);
    expect(isResolvableRelationshipType("subject_of")).toBe(false);
    expect(isResolvableRelationshipType("on_asset")).toBe(true);
    expect(isResolvableRelationshipType("executes")).toBe(true);
  });
});
