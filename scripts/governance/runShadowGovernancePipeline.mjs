import {
  runGovernancePipeline,
} from "./runGovernancePipeline.mjs";

try {
  runGovernancePipeline({
    mode: "shadow",
  });
} catch (error) {
  console.error(
    `FAIL: ${error.message}`,
  );
  process.exit(1);
}
