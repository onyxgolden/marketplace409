import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createFinancialApplicationSuite: vi.fn(),
  importFile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/infrastructure/composition", () => ({
  createFinancialApplicationSuite:
    mocks.createFinancialApplicationSuite,
}));

import {
  POST,
} from "./route";

function createRequest(body) {
  return new Request(
    "http://localhost/api/financial/import",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

function configureAuthenticatedRequest({
  userId = "owner-1",
} = {}) {
  const supabaseClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: userId,
          },
        },
        error: null,
      }),
    },
  };

  mocks.createClient.mockResolvedValue(
    supabaseClient,
  );

  mocks.createFinancialApplicationSuite.mockResolvedValue({
    financialImportApplication: {
      importFile: mocks.importFile,
    },
  });

  return supabaseClient;
}

describe("POST /api/financial/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.importFile.mockResolvedValue({
      imported: 2,
      rejected: 0,
    });
  });

  it("imports authenticated financial CSV content", async () => {
    const supabaseClient =
      configureAuthenticatedRequest();

    const response = await POST(
      createRequest({
        source: "rentec",
        csv: "date,amount\n2026-01-01,1000",
        fileName: "rentec-export.csv",
      }),
    );

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        imported: 2,
        rejected: 0,
      },
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).toHaveBeenCalledWith({
      supabaseClient,
      ownerId: "owner-1",
      currentOwnerId: expect.any(Function),
    });

    const {
      currentOwnerId,
    } = mocks.createFinancialApplicationSuite.mock.calls[0][0];

    await expect(currentOwnerId()).resolves.toBe(
      "owner-1",
    );

    expect(
      mocks.importFile,
    ).toHaveBeenCalledTimes(1);

    const importRequest =
      mocks.importFile.mock.calls[0][0];

    expect(importRequest).toMatchObject({
      source: "rentec",
      ownerId: "owner-1",
      file: {
        name: "rentec-export.csv",
      },
    });

    await expect(
      importRequest.file.text(),
    ).resolves.toBe(
      "date,amount\n2026-01-01,1000",
    );
  });

  it("uses the default financial import filename", async () => {
    configureAuthenticatedRequest();

    await POST(
      createRequest({
        source: "quickbooks",
        csv: "date,amount\n2026-01-01,250",
      }),
    );

    const {
      file,
    } = mocks.importFile.mock.calls[0][0];

    expect(file.name).toBe(
      "financial-import.csv",
    );
  });

  it("returns 401 when no authenticated owner exists", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: null,
          },
          error: null,
        }),
      },
    });

    const response = await POST(
      createRequest({
        source: "rentec",
        csv: "date,amount",
      }),
    );

    expect(response.status).toBe(401);

    await expect(response.json()).resolves.toEqual({
      error:
        "Authenticated owner id is required.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();

    expect(
      mocks.importFile,
    ).not.toHaveBeenCalled();
  });

  it("returns 400 when source or CSV content is missing", async () => {
    configureAuthenticatedRequest();

    const response = await POST(
      createRequest({
        source: "rentec",
      }),
    );

    expect(response.status).toBe(400);

    await expect(response.json()).resolves.toEqual({
      error:
        "Financial import source and CSV content are required.",
    });

    expect(
      mocks.createFinancialApplicationSuite,
    ).not.toHaveBeenCalled();

    expect(
      mocks.importFile,
    ).not.toHaveBeenCalled();
  });

  it("returns 400 when the import application reports an error", async () => {
    configureAuthenticatedRequest();

    mocks.importFile.mockResolvedValue({
      error: "Unsupported financial import source.",
    });

    const response = await POST(
      createRequest({
        source: "unknown",
        csv: "date,amount",
      }),
    );

    expect(response.status).toBe(400);

    await expect(response.json()).resolves.toEqual({
      error:
        "Unsupported financial import source.",
    });
  });

  it("returns 500 when financial import execution fails", async () => {
    configureAuthenticatedRequest();

    mocks.importFile.mockRejectedValue(
      new Error("Repository unavailable."),
    );

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await POST(
      createRequest({
        source: "rentec",
        csv: "date,amount",
      }),
    );

    expect(response.status).toBe(500);

    await expect(response.json()).resolves.toEqual({
      error: "Repository unavailable.",
    });

    expect(consoleError).toHaveBeenCalledWith(
      "Financial import error",
      expect.any(Error),
    );

    consoleError.mockRestore();
  });
});
