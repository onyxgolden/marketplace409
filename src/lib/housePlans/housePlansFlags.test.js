import {
  HOUSE_PLANS_FLAG_KEY,
  browserHousePlansEnvironment,
  isHousePlansEnabled,
  readHousePlansConfig,
} from "./housePlansFlags";

describe("housePlansFlags (HP-L0)", () => {
  const ORIGINAL = process.env[HOUSE_PLANS_FLAG_KEY];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env[HOUSE_PLANS_FLAG_KEY];
    else process.env[HOUSE_PLANS_FLAG_KEY] = ORIGINAL;
  });

  it("exposes the NEXT_PUBLIC_ flag key", () => {
    expect(HOUSE_PLANS_FLAG_KEY).toBe("NEXT_PUBLIC_HOUSE_PLANS_ENABLED");
  });

  it("is off by default (env unset)", () => {
    expect(readHousePlansConfig({}).enabled).toBe(false);
  });

  it("is off for any value other than the string \"true\"", () => {
    for (const value of ["false", "0", "yes", "TRUE", " true", ""]) {
      expect(readHousePlansConfig({ [HOUSE_PLANS_FLAG_KEY]: value }).enabled).toBe(false);
    }
  });

  it("is on only when the flag is exactly \"true\"", () => {
    expect(readHousePlansConfig({ [HOUSE_PLANS_FLAG_KEY]: "true" }).enabled).toBe(true);
  });

  it("returns a frozen config object", () => {
    expect(Object.isFrozen(readHousePlansConfig({}))).toBe(true);
  });

  it("isHousePlansEnabled defaults to off in the test environment", () => {
    delete process.env[HOUSE_PLANS_FLAG_KEY];
    expect(isHousePlansEnabled()).toBe(false);
  });

  it("isHousePlansEnabled turns on when the env flag is set", () => {
    process.env[HOUSE_PLANS_FLAG_KEY] = "true";
    expect(isHousePlansEnabled()).toBe(true);
  });

  it("browserHousePlansEnvironment snapshots only the flag key", () => {
    process.env[HOUSE_PLANS_FLAG_KEY] = "true";
    expect(browserHousePlansEnvironment()).toEqual({ [HOUSE_PLANS_FLAG_KEY]: "true" });
  });
});
