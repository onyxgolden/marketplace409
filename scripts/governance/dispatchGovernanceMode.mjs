export function dispatchGovernanceMode(
  {
    mode,
    runShadowPipeline,
    synchronizeAuthoritative,
  },
) {
  switch (mode) {
    case "shadow":
      return runShadowPipeline();

    case "locked":
      console.log(
        "Governance pipeline is locked. No snapshots, state, or governance documents were written.",
      );
      return;

    case "hybrid": {
      console.log(
        "Hybrid governance pipeline initialized.",
      );

      runShadowPipeline();

      const authoritativeResult =
        synchronizeAuthoritative({
          mode: "hybrid",
        });

      console.log(
        "Hybrid governance completed shadow synchronization and delegated authoritative synchronization.",
      );

      return authoritativeResult;
    }

    case "authoritative":
      return synchronizeAuthoritative({
        mode: "authoritative",
      });

    default:
      throw new Error(
        `Unsupported governance mode: ${mode}`,
      );
  }
}
