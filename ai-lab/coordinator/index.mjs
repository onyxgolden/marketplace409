// AI Lab Coordinator — Phase 2 fixture-only prototype (public API).
//
// Read-only evidence/state classification. No execution capability: this
// module cannot merge, deploy, write files, or call any network service.
export { createCoordinator } from "./coordinator.mjs";
export { createTrustedProvenanceRegistry, createTrustedChannelStore } from "./trusted.mjs";
export {
  PRINCIPALS,
  UNRESOLVED_MUSE,
  isKnownPrincipal,
  resolveAttribution,
  displayAliasFor,
} from "./principals.mjs";
export {
  TRUSTED_TOKEN_ISSUER,
  AUTHORIZATION_PROVENANCE_UNKNOWN,
  scopeCovers,
  validateRatificationToken,
} from "./tokens.mjs";
export { ARTIFACT_KINDS, sourceFileId, validateArtifactShape } from "./artifacts.mjs";
