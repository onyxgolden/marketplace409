import {
FavoriteApplication,
JobApplication,
ListingApplication,
MyListingsApplication,
PetApplication,
PetVotingApplication,
SavedListingsApplication,
} from "../../application/index.js";

import { supabase } from "../../lib/supabase.js";
import { uploadImage } from "../../lib/uploadImage.js";

export function createMarketplaceApplicationSuite(deps = {}) {
const marketplaceSupabase =
deps.supabase || supabase;

const imageUploader =
deps.imageUploader || uploadImage;

const listingApplication =
deps.listingApplication ||
new ListingApplication({
supabase: marketplaceSupabase,
imageUploader,
});

const myListingsApplication =
deps.myListingsApplication ||
new MyListingsApplication({
supabase: marketplaceSupabase,
});

const favoriteApplication =
deps.favoriteApplication ||
new FavoriteApplication({
supabase: marketplaceSupabase,
});

const savedListingsApplication =
deps.savedListingsApplication ||
new SavedListingsApplication({
supabase: marketplaceSupabase,
});

const jobApplication =
deps.jobApplication ||
new JobApplication({
supabase: marketplaceSupabase,
});

const petApplication =
deps.petApplication ||
new PetApplication({
supabase: marketplaceSupabase,
imageUploader,
});

const petVotingApplication =
deps.petVotingApplication ||
new PetVotingApplication({
supabase: marketplaceSupabase,
});

return Object.freeze({
supabase: marketplaceSupabase,
imageUploader,
listingApplication,
myListingsApplication,
favoriteApplication,
savedListingsApplication,
jobApplication,
petApplication,
petVotingApplication,
});
}
