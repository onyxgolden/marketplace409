import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalPhotoUpload from "./RentalPhotoUpload";

describe("RentalPhotoUpload", () => {
  it("shows an empty placeholder and 'Add photo' when no photo is set, with no remove button", () => {
    const markup = renderToStaticMarkup(<RentalPhotoUpload entityType="unit" entityId="unit_1" photoUrl={null} onUploaded={() => {}} />);
    expect(markup).toContain("No photo");
    expect(markup).toContain("Add photo");
    expect(markup).not.toContain("Remove photo");
  });
  it("shows the existing photo, 'Replace photo', and 'Remove photo' when one is set", () => {
    const markup = renderToStaticMarkup(<RentalPhotoUpload entityType="tenant" entityId="tenant_1" photoUrl="https://signed.test/photo" onUploaded={() => {}} />);
    expect(markup).toContain('src="https://signed.test/photo"');
    expect(markup).toContain("Replace photo");
    expect(markup).toContain("Remove photo");
    expect(markup).not.toContain("No photo");
  });
});
