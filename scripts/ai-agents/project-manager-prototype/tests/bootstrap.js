// bootstrap.js — PM651-008 trust gate for unit test entrypoints.
// MUST be imported FIRST (before any ../src/* import) in every .test.js file.
// Verifies the manifest digest against the host-supplied PM_TRUST_ROOT and
// every listed file hash BEFORE any agent code is evaluated. On failure,
// verify() calls process.exit(1), so no agent code runs.
// The host must set PM_TRUST_ROOT to the approved 64-hex manifest digest.
import { verify } from '../corpus/trust-bootstrap.js';
verify();
