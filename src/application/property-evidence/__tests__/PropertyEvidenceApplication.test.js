import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  EVIDENCE_BUCKET,
  MAX_EVIDENCE_BYTES,
  PropertyEvidenceApplication,
  buildStoredFilename,
} from "../PropertyEvidenceApplication";

describe(
  "PropertyEvidenceApplication",
  () => {
    let repository;
    let upload;
    let storage;
    let application;

    beforeEach(() => {
      repository = {
        save: vi.fn(
          async (
            evidence,
          ) => evidence,
        ),
      };

      upload =
        vi.fn()
          .mockResolvedValue({
            data: {
              path:
                "stored/path",
            },
            error: null,
          });

      storage = {
        from: vi.fn(
          () => ({
            upload,
          }),
        ),
      };

      application =
        new PropertyEvidenceApplication({
          repository,
          storage,
          clock:
            () =>
              "2026-08-08T21:00:00.000Z",
          idFactory:
            () =>
              "evidence-uuid-1",
        });
    });

    it(
      "preserves private owner-scoped evidence and metadata",
      async () => {
        const evidence =
          await application.preserve({
            ownerId:
              "owner-1",
            propertyId:
              "1214-wagner",
            hvacSystemId:
              "hvac-system-1",
            bytes:
              new Uint8Array([
                37,
                80,
                68,
                70,
              ]).buffer,
            originalFilename:
              "Invoice #603.pdf",
            mimeType:
              "application/pdf",
            extractionMethod:
              "native_pdf",
            parserVersion:
              "hvac-invoice-v1",
          });

        expect(
          storage.from,
        ).toHaveBeenCalledWith(
          EVIDENCE_BUCKET,
        );

        expect(
          upload,
        ).toHaveBeenCalledWith(
          "owner-1/1214-wagner/property_evidence_evidence-uuid-1/Invoice-603.pdf",
          expect.any(
            Uint8Array,
          ),
          {
            contentType:
              "application/pdf",
            upsert: false,
          },
        );

        expect(
          repository.save,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            id:
              "property_evidence_evidence-uuid-1",
            ownerId:
              "owner-1",
            propertyId:
              "1214-wagner",
            hvacSystemId:
              "hvac-system-1",
            hvacEventId:
              null,
            bucket:
              "property-evidence",
            originalFilename:
              "Invoice #603.pdf",
            byteSize: 4,
            extractionMethod:
              "native_pdf",
            parserVersion:
              "hvac-invoice-v1",
            reviewStatus:
              "pending_review",
          }),
          {
            ownerId:
              "owner-1",
          },
        );

        expect(
          evidence.objectPath,
        ).toBe(
          "owner-1/1214-wagner/property_evidence_evidence-uuid-1/Invoice-603.pdf",
        );

        expect(
          Object.isFrozen(
            evidence,
          ),
        ).toBe(true);
      },
    );

    it(
      "uses controlled extensions instead of trusting the filename",
      () => {
        expect(
          buildStoredFilename({
            originalFilename:
              "../../Invoice 603.exe",
            mimeType:
              "application/pdf",
          }),
        ).toBe(
          "Invoice-603.pdf",
        );

        expect(
          buildStoredFilename({
            originalFilename:
              "air handler photo",
            mimeType:
              "image/jpeg",
          }),
        ).toBe(
          "air-handler-photo.jpg",
        );
      },
    );

    it(
      "rejects unsupported MIME types before upload",
      async () => {
        await expect(
          application.preserve({
            ownerId:
              "owner-1",
            propertyId:
              "property-1",
            bytes:
              new Uint8Array([
                1,
              ]),
            originalFilename:
              "invoice.txt",
            mimeType:
              "text/plain",
          }),
        ).rejects.toThrow(
          "Property evidence must be a PDF, JPEG, or PNG file.",
        );

        expect(
          upload,
        ).not.toHaveBeenCalled();

        expect(
          repository.save,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects empty and oversized files before upload",
      async () => {
        await expect(
          application.preserve({
            ownerId:
              "owner-1",
            propertyId:
              "property-1",
            bytes:
              new Uint8Array(),
            originalFilename:
              "invoice.pdf",
            mimeType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "Property evidence file is empty.",
        );

        await expect(
          application.preserve({
            ownerId:
              "owner-1",
            propertyId:
              "property-1",
            bytes:
              new Uint8Array(
                MAX_EVIDENCE_BYTES +
                  1,
              ),
            originalFilename:
              "invoice.pdf",
            mimeType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "Property evidence file must not exceed 10 MB.",
        );

        expect(
          upload,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not write metadata when private upload fails",
      async () => {
        const uploadError =
          new Error(
            "Private upload failed.",
          );

        upload
          .mockResolvedValue({
            data: null,
            error:
              uploadError,
          });

        await expect(
          application.preserve({
            ownerId:
              "owner-1",
            propertyId:
              "property-1",
            bytes:
              new Uint8Array([
                1,
                2,
              ]),
            originalFilename:
              "invoice.pdf",
            mimeType:
              "application/pdf",
          }),
        ).rejects.toBe(
          uploadError,
        );

        expect(
          repository.save,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "requires owner, property, repository, and storage boundaries",
      async () => {
        expect(
          () =>
            new PropertyEvidenceApplication({
              storage,
            }),
        ).toThrow(
          "PropertyEvidenceApplication requires a repository.",
        );

        expect(
          () =>
            new PropertyEvidenceApplication({
              repository,
            }),
        ).toThrow(
          "PropertyEvidenceApplication requires storage.",
        );

        await expect(
          application.preserve({
            propertyId:
              "property-1",
            bytes:
              new Uint8Array([
                1,
              ]),
            originalFilename:
              "invoice.pdf",
            mimeType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "Property evidence owner id is required.",
        );

        await expect(
          application.preserve({
            ownerId:
              "owner-1",
            bytes:
              new Uint8Array([
                1,
              ]),
            originalFilename:
              "invoice.pdf",
            mimeType:
              "application/pdf",
          }),
        ).rejects.toThrow(
          "Property evidence property id is required.",
        );
      },
    );
  },
);
