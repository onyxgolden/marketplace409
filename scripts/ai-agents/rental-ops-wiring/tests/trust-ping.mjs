/**
 * trust-ping.mjs — minimal authenticated entry used by the trust
 * bootstrap regression tests. Prints one line and exits 0; it proves
 * the trust entry reaches a manifest-listed module on the happy path
 * without recursing into the test runner.
 */
console.log("trust-ping-ok");
