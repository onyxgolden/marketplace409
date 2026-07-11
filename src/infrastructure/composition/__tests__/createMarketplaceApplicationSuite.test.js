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
FavoriteApplication,
JobApplication,
ListingApplication,
MyListingsApplication,
PetApplication,
PetVotingApplication,
SavedListingsApplication,
} from "../../../application/index.js";

import {
createMarketplaceApplicationSuite,
} from "../createMarketplaceApplicationSuite.js";

describe("createMarketplaceApplicationSuite", () => {
it("builds the default marketplace application suite", () => {
const suite = createMarketplaceApplicationSuite();

expect(suite.supabase).toBe(defaultSupabase);
expect(suite.imageUploader).toBe(defaultImageUploader);

expect(suite.listingApplication).toBeInstanceOf(
  ListingApplication,
);
expect(suite.myListingsApplication).toBeInstanceOf(
  MyListingsApplication,
);
expect(suite.favoriteApplication).toBeInstanceOf(
  FavoriteApplication,
);
expect(suite.savedListingsApplication).toBeInstanceOf(
  SavedListingsApplication,
);
expect(suite.jobApplication).toBeInstanceOf(
  JobApplication,
);
expect(suite.petApplication).toBeInstanceOf(
  PetApplication,
);
expect(suite.petVotingApplication).toBeInstanceOf(
  PetVotingApplication,
);

expect(suite.listingApplication.supabase).toBe(
  suite.supabase,
);
expect(suite.listingApplication.imageUploader).toBe(
  suite.imageUploader,
);
expect(suite.myListingsApplication.supabase).toBe(
  suite.supabase,
);
expect(suite.favoriteApplication.supabase).toBe(
  suite.supabase,
);
expect(suite.savedListingsApplication.supabase).toBe(
  suite.supabase,
);
expect(suite.jobApplication.supabase).toBe(
  suite.supabase,
);
expect(suite.petApplication.supabase).toBe(
  suite.supabase,
);
expect(suite.petApplication.imageUploader).toBe(
  suite.imageUploader,
);
expect(suite.petVotingApplication.supabase).toBe(
  suite.supabase,
);

expect(Object.isFrozen(suite)).toBe(true);

});

it("injects shared infrastructure through every application", () => {
const supabase = {};
const imageUploader = vi.fn();

const suite = createMarketplaceApplicationSuite({
  supabase,
  imageUploader,
});

expect(suite.supabase).toBe(supabase);
expect(suite.imageUploader).toBe(imageUploader);
expect(suite.listingApplication.supabase).toBe(supabase);
expect(suite.listingApplication.imageUploader).toBe(
  imageUploader,
);
expect(suite.myListingsApplication.supabase).toBe(supabase);
expect(suite.favoriteApplication.supabase).toBe(supabase);
expect(suite.savedListingsApplication.supabase).toBe(
  supabase,
);
expect(suite.jobApplication.supabase).toBe(supabase);
expect(suite.petApplication.supabase).toBe(supabase);
expect(suite.petApplication.imageUploader).toBe(
  imageUploader,
);
expect(suite.petVotingApplication.supabase).toBe(supabase);

});

it("allows every application to be injected", () => {
const listingApplication = {};
const myListingsApplication = {};
const favoriteApplication = {};
const savedListingsApplication = {};
const jobApplication = {};
const petApplication = {};
const petVotingApplication = {};

const suite = createMarketplaceApplicationSuite({
  listingApplication,
  myListingsApplication,
  favoriteApplication,
  savedListingsApplication,
  jobApplication,
  petApplication,
  petVotingApplication,
});

expect(suite.listingApplication).toBe(
  listingApplication,
);
expect(suite.myListingsApplication).toBe(
  myListingsApplication,
);
expect(suite.favoriteApplication).toBe(
  favoriteApplication,
);
expect(suite.savedListingsApplication).toBe(
  savedListingsApplication,
);
expect(suite.jobApplication).toBe(jobApplication);
expect(suite.petApplication).toBe(petApplication);
expect(suite.petVotingApplication).toBe(
  petVotingApplication,
);

});
});
