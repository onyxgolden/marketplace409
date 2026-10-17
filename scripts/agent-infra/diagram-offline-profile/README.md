# Diagram offline output profile

FORGE-side offline export profile + static checker for diagrams generated
with the installed `diagram-design` skill (v2.6, MIT). Scope:
`~/workspace/forge-ai-drop/briefs/agent-infra/offline-diagram-output-profile-scope-2026-10-16.md`
(build authorized by Jason 2026-10-16).

## Files

- `INVENTORY.md` — installed-skill inventory (source, version, hashes, license).
- `offline-profile.md` — the explicit offline export profile.
- `check_offline.py` — static conformance checker (exit 0 = offline-clean).
- `sanitize_offline.py` — HTML → offline HTML converter (reports counts only).
- `run_tests.py` — 19-test suite: 12-fixture static checks, sanitizer
  label preservation, Playwright network-denied render + PNG export,
  private-label leak checks.
- `fixtures/` — 12 synthetic diagrams (4 valid, 4 external-resource
  attempts, 4 active-content/oversized/malformed).

## Reproduce

```bash
cd scripts/agent-infra/diagram-offline-profile
python3 check_offline.py fixtures/valid-01.html        # exit 0
python3 check_offline.py fixtures/external-01.html     # exit 1, findings
python3 sanitize_offline.py fixtures/valid-03.html /tmp/out.html
python3 run_tests.py --network                         # 19/19
```

Playwright network test needs `pip install playwright` and a local
Chromium (`~/.cache/ms-playwright`).
