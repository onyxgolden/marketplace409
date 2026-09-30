# Severity model (assignment section E)

Four deterministic bands: **informational / attention / high / critical.**
Each event's severity is derived from a named, versioned rule — never from an
AI judgment call, and never a black-box numeric score. If a rule needs to
change, the rule changes (with its own review), not a hidden weight.

## Bands

| Band | Meaning | Expected response |
| --- | --- | --- |
| `informational` | Expected/benign state, or a change with no known risk signal. | None — visible in history, not surfaced as an alert. |
| `attention` | Worth a human look; not urgent, not evidence of compromise on its own. | Surfaced in the dashboard's recent-events list. |
| `high` | A real security-relevant change that a defender-minded person should act on soon. | Surfaced prominently; contributes to overall machine status. |
| `critical` | A protection control is down, or something with a strong compromise signal has occurred. | Surfaced immediately, at the top of the dashboard. |

## Worked examples (illustrative, not exhaustive — Rung 1/3 will formalize the full rule table as code)

| Event | Rule | Band | Why |
| --- | --- | --- | --- |
| Defender real-time protection disabled | `defender.rtp_disabled` | `critical`, unless corroborated as an expected admin action within a short grace window after a manual Defender settings change the user just made (`attention`/`high` downgrade requires corroborating evidence, e.g. a matching interactive-logon session at the same time — never a downgrade based on "seems fine") | Loss of a primary protection control is the single highest-value signal this product exists to catch. |
| Defender malware detection reported | `defender.detection_reported` | Inherits Defender's own reported severity, tagged with FORGE provenance; FORGE does not re-score it | Per the assignment: reflect Defender's supplied severity plus FORGE provenance, never override it with an invented score. |
| New local account added | `account.new_local_user` | `attention` (first observation) — see the baseline note below | A new account is not inherently malicious (Jason may have just created one), but it's always worth a look. |
| New account added to Administrators | `account.new_admin_member` | `high` | Elevated-privilege membership changes are higher-value signals than plain account creation. |
| New signed application listening on localhost only | `network.new_listener` with `address_class=loopback` and `signature_state=signed` | `informational`/`attention` (policy-dependent — Jason can tune this threshold in Rung 3+, but the default is quiet, since loopback-only signed listeners are extremely common on a dev machine) | Matches the assignment's own example directly. |
| New unsigned application listening on a private/public address | `network.new_listener` with `address_class!=loopback` and `signature_state!=signed` | `high` | Combines two independent risk factors (exposure + lack of attestable identity). |
| New scheduled task or service pointing at an unsigned executable | `persistence.new_unsigned` | `high` | Persistence + no signer identity is a strong combined signal. |
| New scheduled task or service pointing at a signed, known executable | `persistence.new_signed_known` | `attention` (first observation) | Still worth logging — legitimate software installs persistence constantly — but not alarming on its own. |
| RDP enabled where it was previously disabled | `rdp.enabled` | `high` | Directly expands remote-access attack surface. |
| RDP enabled with NLA off | `rdp.enabled_no_nla` | `critical` | Materially weaker configuration than RDP-with-NLA; treated as its own, worse case rather than a sub-note. |
| Windows Firewall profile disabled | `firewall.profile_disabled` | `critical` | Same reasoning as Defender RTP — a primary protection control going down. |
| Critical allowlisted file changed unexpectedly | `fim.allowlist_changed` | `high` (or `critical` if the path is this product's own binary/config — tampering with the security tool itself is treated as worse than tampering with an arbitrary allowlisted file) | |
| Failed-login burst (audit policy confirmed enabled) | `auth.failed_login_burst` | `attention` rising to `high` past a configurable threshold count/window | Avoids false urgency from a single mistyped password while still catching a real burst. |
| Security update posture stale beyond threshold | `update.posture_stale` | `attention` | Best-effort surface (see source inventory) — treated as a nudge, not an alarm, given its own reliability caveat. |
| Any source read fails (`collection_health` != ok) | n/a — this is not a security event, it's a collector-health event | Surfaced as **unknown**, never folded into "no news is good news" | Per the "unknown is not healthy" data-contract rule. |

## Rules for building the real rule table (Rung 1/3)

1. **One rule ID, one band, one explanation string, versioned.** A rule
   change is a code change with its own diff and its own test — not a tunable
   the UI silently adjusts.
2. **Corroboration only ever raises caution, never manufactures calm.** A rule
   may combine signals to justify raising a band (e.g. "new admin account" +
   "created outside business hours" -> higher confidence it's worth surfacing
   sooner), but no combination of signals is allowed to auto-downgrade a
   `critical` protection-control-down event to something quieter without an
   explicit, reviewed exception rule — see the Defender RTP row above for the
   one deliberate exception, and note even that one requires corroborating
   evidence, not silence.
3. **Raw OS severity is preserved, never replaced.** Per the
   [privacy/data contract](./privacy-data-contract.md#minimum-event-schema),
   `raw_os_severity` sits alongside FORGE's own `severity`; a rule can read
   the raw value as an input but must not overwrite it.
4. **First observation vs. change are different rule inputs.** Several rules
   above (new account, new persistence entry) depend on baseline-vs-diff
   framing established in the [threat model](./threat-model.md): the first
   time FORGE Security ever runs, "discovering" the existing accounts/
   services/tasks already on the machine is not the same event as one
   appearing afterward. Rung 2's schema and Rung 3's collectors must
   distinguish "this is the baseline" from "this changed since the baseline"
   explicitly, not infer it from record age.
5. **No numeric composite score.** Bands are the unit of classification
   surfaced to Jason. If a future rung wants a single "machine health"
   summary, it is computed as "the worst current unresolved band plus a count
   per band," not a weighted arithmetic score that obscures which specific
   evidence drove it.
