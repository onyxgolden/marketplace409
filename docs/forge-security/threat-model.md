# Threat model (assignment section B)

## Scope

FORGE Security's initial scope is Jason's Windows 11 iBUYPOWER workstation —
an important local-AI/development machine. The threats below are the ones
this product is meant to surface in Rungs 1–4 (observe + explain). Response
capability (Rung 6) is out of scope for this document; it only needs the
evidence this model produces to exist first.

## Threats FORGE Security is intended to surface

Each threat lists the [source(s)](./windows-sources.md) it's read from and,
loosely, which [severity](./severity-rules.md) band it would land in — final
banding happens in the severity-rules document, not here.

1. **Defender/firewall/security controls unexpectedly disabled or weakened** —
   real-time protection turned off, an exclusion added, a firewall profile
   disabled, or a firewall default action changed to allow. Sources: Defender
   status/event log, Firewall profile/event log, Security Center aggregate.
2. **Malware/security detections already produced by Defender** — surfacing
   Defender's own findings inside one FORGE console rather than requiring
   Jason to open Windows Security separately. Source: Defender threat
   detection history and Operational event log.
3. **New persistence** — a new startup entry, scheduled task, or service that
   wasn't there before. Source: services/tasks/startup inventory, diffed
   against the prior baseline.
4. **Unexpected new local/admin accounts or privilege changes** — a new local
   user, or an existing user added to Administrators. Sources: local
   user/group enumeration, Security log 4720/4732/4728.
5. **RDP/remote-access enablement or configuration changes** — RDP turned on,
   NLA turned off, or the Remote Desktop firewall rule group enabled. Sources:
   RDP registry state, firewall rule group state, RDP session event log.
6. **New listening ports / meaningful network exposure changes** — a new
   process binds a listening socket, especially on a non-loopback address.
   Source: socket enumeration diffed against baseline, joined to process +
   signature metadata.
7. **Unexpected executable/process changes** — a new, unsigned, or
   newly-appearing executable behind a persistence entry or listening socket.
   Sources: Authenticode signature + hash on the specific file a persistence
   or network event points to (not a full-disk scan).
8. **Critical FORGE/config file changes** — modification to a small,
   explicitly allowlisted set of paths (this product's own binaries/config,
   other FORGE-critical local config Jason designates). Source: file
   integrity monitoring on the allowlist.
9. **Suspicious changes to development/security configuration** — e.g. a
   change to this machine's own security-relevant settings that doesn't match
   an expected admin action. This is a corroboration threat: it's covered by
   combining items 1, 3, and 4 above rather than a separate source.
10. **Failed-login bursts where reliable evidence exists** — repeated 4625
    events in a short window. Source: Security log, gated on audit policy for
    logon events actually being enabled (see the audit-policy caveat in
    [`windows-sources.md`](./windows-sources.md#5-windows-event-log-authentication-processservicetasksecurity)).
11. **Security update posture changes** — the machine falls behind on
    installed updates, or the last successful update check/install is stale
    beyond a threshold. Source: update posture surface (acknowledged
    best-effort — see the same document).

## Explicit non-goals for early rungs

FORGE Security is not, and Rungs 0–5 will not attempt to become:

- **Malware reverse engineering.** No disassembly, no sandboxed detonation,
  no unpacking of suspicious binaries. If Defender or another OS signal flags
  something, FORGE Security surfaces that flag with its evidence — it does
  not independently analyze the payload.
- **Exploit development or offensive scanning.** No port-scanning other
  machines, no vulnerability scanning of network peers, no proof-of-concept
  exploitation of anything found. This product looks inward at the machine it
  runs on, never outward at others.
- **Packet interception or decryption.** No network traffic capture, no TLS
  interception, no DPI. Network visibility is limited to local listening-
  socket/process metadata (§8 of the source inventory), never payload
  content.
- **Credential capture of any kind.** Reiterating the product boundary: no
  passwords, tokens, private keys, cookies, session secrets, or `.env`
  contents, under any circumstance, even for "detection" purposes.
- **Behavioral/ML malware detection.** Rungs 0–5 use deterministic,
  explainable rules over structured OS evidence, not a trained classifier
  making an opaque call. A future ML-assisted signal (if ever pursued) would
  need its own threat-model and severity-model revision — it is not assumed
  here.
- **Automatic remediation of any kind.** No auto-kill, auto-quarantine,
  auto-isolate, auto-delete, auto-revoke, or auto-disable, anywhere before
  Rung 6 — and even there, only with explicit per-action human confirmation
  (see [ADR-004](./ADR-004-human-confirmed-response.md)).

## Threats explicitly deferred (not covered by this document)

- Physical access / firmware / BIOS-level compromise (TPM attestation, Secure
  Boot tampering) — a real and serious threat class, but it needs its own
  source inventory (UEFI/TPM read surfaces) that Rung 0 has not investigated.
  Flag as a candidate for a future architecture addendum, not Rung 1–3 scope.
- Supply-chain compromise of software Jason installs — FORGE Security can
  observe a new, unexpectedly-unsigned executable appearing (threat 7 above),
  which is a partial mitigation, but it does not verify build provenance or
  package integrity for third-party software.
- Multi-machine/network-wide threats — deferred to Rung 8 (multi-machine
  console). Rungs 0–7 are single-machine, local evidence only.
