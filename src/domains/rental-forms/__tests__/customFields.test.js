import { describe, expect, it } from "vitest";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  formatFieldValue,
  slugifyFieldKey,
  validateFieldDefinition,
  validateFieldValue,
} from "../customFields";

const textField = { name: "Gate code", field_type: "text", is_required: false };
const numberField = { name: "Pets", field_type: "number", is_required: false };
const dateField = { name: "Move-out inspection", field_type: "date", is_required: false };
const yesNoField = { name: "Has renter's insurance", field_type: "yes_no", is_required: false };
const picklistField = {
  name: "Parking spot",
  field_type: "picklist",
  is_required: false,
  picklist_options: ["A1", "A2", "B1"],
};

describe("custom field key slugs", () => {
  it("derives a placeholder-safe key from the name", () => {
    expect(slugifyFieldKey("Lease signer phone")).toBe("lease_signer_phone");
    expect(slugifyFieldKey("  Gate code #2 ")).toBe("gate_code_2");
  });
});

describe("field definition validation", () => {
  it("accepts a valid definition for each entity and type", () => {
    for (const entity of CUSTOM_FIELD_ENTITIES) {
      for (const type of CUSTOM_FIELD_TYPES) {
        const input = {
          name: `Some ${type.key}`,
          entity: entity.key,
          fieldType: type.key,
          picklistOptions: ["One", "Two"],
        };
        const result = validateFieldDefinition(input);
        expect(result.ok, `${entity.key}/${type.key}`).toBe(true);
        expect(result.clean.fieldKey).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });

  it("rejects missing names, bad entities, and bad types with plain-English errors", () => {
    expect(validateFieldDefinition({ entity: "tenant", fieldType: "text" }).error).toMatch(/name/i);
    expect(validateFieldDefinition({ name: "X", entity: "car", fieldType: "text" }).error).toMatch(/tenant/);
    expect(validateFieldDefinition({ name: "X", entity: "tenant", fieldType: "richtext" }).error).toMatch(/type/i);
  });

  it("requires at least two non-blank picklist choices", () => {
    expect(validateFieldDefinition({ name: "Spot", entity: "unit", fieldType: "picklist", picklistOptions: ["A1"] }).ok).toBe(false);
    expect(validateFieldDefinition({ name: "Spot", entity: "unit", fieldType: "picklist", picklistOptions: ["A1", " ", "A1"] }).ok).toBe(false);
    const result = validateFieldDefinition({
      name: "Spot", entity: "unit", fieldType: "picklist", picklistOptions: ["A1", "A1", "B1"],
    });
    expect(result.ok).toBe(true);
    expect(result.clean.picklistOptions).toEqual(["A1", "B1"]);
  });

  it("forces picklist options to null for non-picklist types", () => {
    const result = validateFieldDefinition({ name: "X", entity: "tenant", fieldType: "text", picklistOptions: ["a"] });
    expect(result.ok).toBe(true);
    expect(result.clean.picklistOptions).toBeNull();
  });
});

describe("field value validation", () => {
  it("accepts blank values for optional fields and rejects them when required", () => {
    expect(validateFieldValue(textField, "").clean).toBeNull();
    expect(validateFieldValue(textField, null).clean).toBeNull();
    expect(validateFieldValue({ ...textField, is_required: true }, " ").ok).toBe(false);
    expect(validateFieldValue({ ...textField, is_required: true }, "").error).toMatch(/required/i);
  });

  it("validates text length", () => {
    expect(validateFieldValue(textField, "4821").clean).toBe("4821");
    expect(validateFieldValue(textField, "x".repeat(501)).ok).toBe(false);
  });

  it("validates numbers", () => {
    expect(validateFieldValue(numberField, "2").clean).toBe("2");
    expect(validateFieldValue(numberField, " 3.5 ").clean).toBe("3.5");
    expect(validateFieldValue(numberField, "-1").clean).toBe("-1");
    expect(validateFieldValue(numberField, "two").ok).toBe(false);
    expect(validateFieldValue(numberField, "1,000").ok).toBe(false);
  });

  it("validates real calendar dates only", () => {
    expect(validateFieldValue(dateField, "2026-10-01").clean).toBe("2026-10-01");
    expect(validateFieldValue(dateField, "2026-02-30").ok).toBe(false); // not a real date
    expect(validateFieldValue(dateField, "10/01/2026").ok).toBe(false);
    expect(validateFieldValue(dateField, "not a date").ok).toBe(false);
  });

  it("normalizes yes/no answers", () => {
    expect(validateFieldValue(yesNoField, "yes").clean).toBe("yes");
    expect(validateFieldValue(yesNoField, "YES").clean).toBe("yes");
    expect(validateFieldValue(yesNoField, true).clean).toBe("yes");
    expect(validateFieldValue(yesNoField, "no").clean).toBe("no");
    expect(validateFieldValue(yesNoField, "0").clean).toBe("no");
    expect(validateFieldValue(yesNoField, "maybe").ok).toBe(false);
  });

  it("restricts picklist values to the defined choices", () => {
    expect(validateFieldValue(picklistField, "A1").clean).toBe("A1");
    expect(validateFieldValue(picklistField, "Z9").ok).toBe(false);
  });
});

describe("field value formatting", () => {
  it("renders yes/no and dates in plain English", () => {
    expect(formatFieldValue(yesNoField, "yes")).toBe("Yes");
    expect(formatFieldValue(yesNoField, "no")).toBe("No");
    expect(formatFieldValue(dateField, "2026-10-01")).toBe("Oct 1, 2026");
  });
  it("renders blanks as an em dash", () => {
    expect(formatFieldValue(textField, null)).toBe("—");
    expect(formatFieldValue(textField, "")).toBe("—");
  });
});
