# Windows source inventory (assignment section A)

This is the catalog of supported Windows surfaces FORGE Security should read
from, instead of building a replacement detection engine. For every source:
the exact mechanism (not a guess), what privilege it needs, how reliable it
is, what it costs to collect, whether it's poll- or event-driven, and whether
it can carry sensitive data that the [privacy/data contract](./privacy-data-contract.md)
must constrain.

Nothing here is implemented in Rung 0. This is the map Rung 1–3 build from.

## Legend

- **Privilege:** `standard` (current user, no elevation), `admin` (local
  administrator), `system` (LocalSystem / a privileged service).
- **Reliability:** `stable-documented` (Microsoft-documented, stable contract),
  `stable-undocumented` (widely relied upon in practice, no formal
  compatibility guarantee), `best-effort` (known to vary by edition/build/config).
- **Mode:** `poll` (collector reads state on an interval), `event` (the OS
  pushes discrete events FORGE Security can subscribe to).

## 1. Microsoft Defender Antivirus

| Aspect | Detail |
| --- | --- |
| Status/config | `Get-MpComputerStatus` (Defender PowerShell module, built into Windows 10/11) — real-time protection state, signature age/version, engine version, last scan times. |
| Detections/history | `Get-MpThreatDetection` and `Get-MpThreat` — active/historical threat detections with Defender's own severity, action taken, and threat name. |
| Preferences | `Get-MpPreference` — exclusions, scan schedule, cloud-protection level. Exclusions are themselves a signal: an attacker or a careless install can add one to hide a payload. |
| WMI equivalent | `ROOT\Microsoft\Windows\Defender` namespace: `MSFT_MpComputerStatus`, `MSFT_MpThreat`, `MSFT_MpThreatDetection`, `MSFT_MpPreference` — same data via CIM/WMI for a non-PowerShell collector. |
| Event log | `Microsoft-Windows-Windows Defender/Operational` — e.g. 1116 (malware detected), 1117 (action taken), 5001 (real-time protection disabled), 5010/5012 (scanning/antispyware disabled), 5007 (configuration changed). Event-driven, low latency for "Defender got turned off" style alerts. |
| Privilege | `standard` for most `Get-Mp*` read cmdlets; reading the Operational event log channel is standard-readable by default. |
| Reliability | stable-documented. |
| Mode | poll (status/history) + event (state-change log). |
| Sensitive? | Threat names/paths can reference files outside FORGE's control (e.g. a flagged document's path). Collect path + hash, not file contents. |

## 2. Windows Firewall

| Aspect | Detail |
| --- | --- |
| Status | `Get-NetFirewallProfile` (NetSecurity module) — per-profile (Domain/Private/Public) enabled state, default inbound/outbound action, logging settings. |
| Rules | `Get-NetFirewallRule` (+ `Get-NetFirewallPortFilter`/`Get-NetFirewallAddressFilter` for detail) — full rule set, including a new rule that opens an unexpected port. |
| Legacy/COM | `HNetCfg.FwPolicy2` COM object — same data, useful if a collector isn't PowerShell-hosted. |
| Change visibility | `Microsoft-Windows-Windows Firewall With Advanced Security/Firewall` event log channel logs rule and profile changes; Security log event 4946–4957 range also covers firewall rule/exception changes on some configurations. |
| Privilege | `standard` to read profile/rule state; `admin` only if FORGE Security ever needs to change anything (it doesn't, in these rungs). |
| Reliability | stable-documented. |
| Mode | poll (baseline + periodic re-check) + event (rule/profile change). |
| Sensitive? | Rule names/ports only; not payload inspection. |

## 3. Windows Security Center (aggregate AV/Firewall/AntiSpyware registration)

| Aspect | Detail |
| --- | --- |
| Mechanism | WMI namespace `root/SecurityCenter2`, classes `AntiVirusProduct`, `FirewallProduct`, `AntiSpywareProduct`. This is what Windows Security's own "Virus & threat protection" tile and third-party AV suites read to show a unified status. |
| Privilege | `standard`. |
| Reliability | **stable-undocumented** — widely relied upon (most third-party AV dashboards use it) but Microsoft has not published it as a versioned public contract, and it has changed shape across Windows releases before. Treat it as a corroborating signal, not the sole source of truth for Defender's own state (use `Get-MpComputerStatus` for that). |
| Mode | poll. |
| Sensitive? | No. |

## 4. Windows Update / security update posture

| Aspect | Detail |
| --- | --- |
| Installed updates | `Get-HotFix` (wraps `Win32_QuickFixEngineering` WMI class) — built-in, standard-readable, but historically incomplete for cumulative updates on newer Windows versions. |
| Update Agent API | `Microsoft.Update.Session` / `Microsoft.Update.Searcher` COM API — the same engine Windows Update itself uses; can enumerate installed/pending updates more completely than `Get-HotFix`, but is a heavier, slower call. |
| Last-success signal | Registry: `HKLM\SOFTWARE\Microsoft\WindowsUpdate\...` last-successful-scan/install timestamps — fast, cheap, best-effort (undocumented exact key layout has shifted across releases; treat as a freshness hint, not authoritative). |
| Privilege | `standard` for read paths above. |
| Reliability | best-effort overall — this is the least clean surface in the inventory. Rung 1 should report "posture known as of last successful check" rather than claim precise patch compliance. |
| Mode | poll. |
| Sensitive? | No. |

## 5. Windows Event Log (authentication, process/service/task/security)

| Aspect | Detail |
| --- | --- |
| Security channel | `Security` log — 4624/4625 (logon success/failure, useful for failed-login-burst detection), 4720 (user account created), 4732/4728 (member added to a local/global group, e.g. Administrators), 4698 (scheduled task created), 4672 (special/admin privileges assigned at logon). Requires the relevant audit policy category to be enabled (`auditpol /get /category:*`); FORGE Security should read current audit policy, not silently assume events exist. |
| System channel | `System` log — 7045 (new service installed), 7040 (service start-type changed), 1074/6006/6008 (shutdown/unexpected shutdown). |
| Scheduled tasks | `Microsoft-Windows-TaskScheduler/Operational` — task creation/deletion/run events, complementary to enumerating tasks directly (see §6). |
| RDP/remote access | `Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational` and `Microsoft-Windows-TerminalServices-LocalSessionManager/Operational` — session connect/disconnect events. |
| Privilege | `standard` to read most channels by default; the `Security` log on some hardened configurations restricts read access to `admin`/`Event Log Readers` group members — FORGE Security's collector account should be added to that group rather than run fully elevated just to read logs. |
| Reliability | stable-documented, but **gated by audit policy** — a channel with the right category disabled simply produces no events. FORGE Security must record and surface current audit-policy state, not just assume coverage. |
| Mode | event (subscribe) is strongly preferred over polling the log; polling large channels is expensive and can miss events if the log wraps between polls. |
| Sensitive? | Account names, source IPs for logons — treat as identifiers to store, not values to redact, but never capture password fields (Windows doesn't log these to begin with). |

## 6. Services, scheduled tasks, startup/persistence

| Aspect | Detail |
| --- | --- |
| Services | `Get-Service` / `Get-CimInstance Win32_Service` (path, start mode, account, state). |
| Scheduled tasks | `Get-ScheduledTask` + `Get-ScheduledTaskInfo` (ScheduledTasks module) — action, trigger, run-as account, last result. |
| Registry Run keys | `HKLM\...\CurrentVersion\Run(Once)` and the `HKCU` equivalents — classic persistence location. |
| Startup folders | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` and the all-users equivalent. |
| Aggregate view | `Win32_StartupCommand` WMI class already merges several of the above into one enumerable list. |
| Privilege | `standard` for per-user locations; `admin` to enumerate all-users/HKLM locations and other users' service accounts fully. |
| Reliability | stable-documented. |
| Mode | poll, baseline-then-diff (see [threat model](./threat-model.md) on first-observation vs. change). |
| Sensitive? | Command lines can contain incidental secrets (a script called with a plaintext argument) — see the data-minimization rule in the [privacy contract](./privacy-data-contract.md). |

## 7. Local users / admin group membership

| Aspect | Detail |
| --- | --- |
| Mechanism | `Get-LocalUser`, `Get-LocalGroupMember -Group Administrators` (`Microsoft.PowerShell.LocalAccounts` module, built-in). |
| Privilege | `standard` to enumerate; membership changes themselves require `admin` to perform (not to observe). |
| Reliability | stable-documented. |
| Mode | poll, baseline-then-diff. |
| Sensitive? | Usernames only, no credentials. |

## 8. Listening sockets / network exposure

| Aspect | Detail |
| --- | --- |
| Mechanism | `Get-NetTCPConnection` / `Get-NetUDPEndpoint` (NetTCPIP module) joined to `Get-Process` by `OwningProcess` for attribution. `netstat -ano` is the fallback on builds/contexts where the module is unavailable. |
| Privilege | `standard` for a user's own processes; `admin` needed to attribute sockets owned by other users'/system processes. |
| Reliability | stable-documented. |
| Mode | poll. Exposure changes (a new listener bound to `0.0.0.0` or a public-facing address) are the meaningful delta, not the raw list. |
| Sensitive? | Remote-address exposure could incidentally reveal internal network topology; keep to address-class-level detail (loopback/private/public) in evidence records per the privacy contract, with full address available in the raw local record if Jason wants to drill in from the UI. |

## 9. Authenticode signature + hashing

| Aspect | Detail |
| --- | --- |
| Mechanism | `Get-AuthenticodeSignature` (built-in) for signer identity and validity status; `Get-FileHash -Algorithm SHA256` (built-in) for content hash. |
| Privilege | `standard` for files the collector account can read. |
| Reliability | stable-documented. |
| Mode | poll/on-demand (triggered by a new-persistence or new-listener event, not scanned continuously across the whole disk). |
| Sensitive? | No — hash and signer metadata only, never file contents. |

## 10. File integrity monitoring (allowlisted paths only)

| Aspect | Detail |
| --- | --- |
| Mechanism | No built-in Windows FIM product. Two realistic building blocks: (a) periodic `Get-FileHash` over a small, explicit allowlist of critical paths (FORGE config, this product's own binaries, a short Jason-curated list); (b) `System.IO.FileSystemWatcher` for near-real-time change notification on the same allowlist, with a hash re-check on each fired event rather than trusting the watcher event alone (watchers can coalesce or miss events under load). |
| Privilege | `standard`/`admin` depending on the path. |
| Reliability | best-effort — deliberately narrow scope (see non-goals) rather than a general-purpose FIM claim. |
| Mode | event (watcher) + poll (periodic re-hash as a correctness backstop). |
| Sensitive? | Depends entirely on what's allowlisted — Jason controls the list; FORGE Security must never default to hashing arbitrary user documents. |

## 11. RDP / remote-access configuration

| Aspect | Detail |
| --- | --- |
| Enable/disable state | Registry `HKLM\System\CurrentControlSet\Control\Terminal Server\fDenyTSConnections` (0 = RDP enabled). |
| Network Level Authentication | `HKLM\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp\SecurityLayer` / `UserAuthentication`. |
| Firewall exposure | `Get-NetFirewallRule -DisplayGroup "Remote Desktop"` — whether the built-in rule group is enabled and its profile scope. |
| Session activity | Event log channels listed in §5. |
| Privilege | `standard` to read the above registry values (readable by default; changing them needs `admin`). |
| Reliability | stable-documented. |
| Mode | poll (config) + event (sessions). |
| Sensitive? | No. |

## 12. Browser-extension inventory (metadata only, never browsing content)

| Aspect | Detail |
| --- | --- |
| Mechanism | Filesystem enumeration only — Chromium-based browsers (Chrome, Edge) store each extension under `%LocalAppData%\<Browser>\User Data\<Profile>\Extensions\<id>\<version>\manifest.json`; Firefox lists installed extensions in `extensions.json` inside the profile folder. Reading the extension id, name, and version from these files requires no browser API, no debugging protocol, and no access to history/bookmarks/cookies. |
| Privilege | `standard` (the browser profile directory is readable by its owning user). |
| Reliability | best-effort — directory layout is stable in practice but not a documented public contract; profile-discovery (multiple profiles per browser) adds complexity Rung 3 should scope carefully. |
| Mode | poll, baseline-then-diff (new/removed extension is the interesting event, not the full list every time). |
| Sensitive? | Extension identity/version only. FORGE Security must not open, parse, or infer browsing content, saved passwords, or history from the same profile directory even though it is technically reachable there — this is a hard boundary, not a technical limitation. |

## Sources deliberately not included in Rung 0 scope

- **Antimalware Scan Interface (AMSI) provider registration** — real and useful,
  but higher complexity/risk (a provider sits in-line with script execution);
  revisit only if a later rung needs it, with its own threat-model review.
- **ETW (Event Tracing for Windows) provider subscriptions** beyond the named
  Event Log channels above — powerful but broad; start with named channels,
  which already cover the Rung 1–3 threat model, before reaching for raw ETW.
- **Cloud/Microsoft Defender for Endpoint / Defender ATP APIs** — those are
  paid, cloud-backed products, explicitly excluded by the "no cloud security
  vendor dependency" boundary.
