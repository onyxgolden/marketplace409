# Brandy AI Voice Receptionist — Track 2 v1

Standalone Python 3.12 voice worker / telephony service, outside the FORGE
web app. Talks to FORGE only through the signed ingestion endpoint
(`src/app/api/rental/receptionist/ingest`). Built from the ChatGPT build
brief `results/chatgpt/voice-receptionist-brandy-build-brief-2026-11-08.md`
(brief §§2–8, 11).

## Hard defaults (all live features OFF)

| Feature | Default | Enablement |
|---|---|---|
| Twilio inbound + Media Streams | DISABLED | `RECEPTIONIST_TELEPHONY_ENABLED=1` + go-live word |
| Outbound emergency calls/SMS | DISABLED | `RECEPTIONIST_OUTBOUND_ALERTS_ENABLED=1` + consent + go-live word |
| Call recording | OFF | `RECEPTIONIST_RECORDING_ENABLED=1` + counsel-approved wording |
| Raw transcript storage | OFF | `RECEPTIONIST_TRANSCRIPT_STORAGE_ENABLED=1` |
| Live tenant sync | OFF | `RECEPTIONIST_LIVE_TENANT_SYNC_ENABLED=1` |

A developer cannot activate any of these by merging alone. No vendor
signup, API keys, live numbers, or real calls are part of this build.
All tests run on synthetic fixtures (invented names, fictional 555
numbers, invented properties).

## Layout

```
app/
  config.py            # env config; disabled-by-default gates
  server.py            # stdlib-only HTTP server (/health, /twilio/*, /alerts/ack)
  session.py           # call lifecycle, append-only events, idempotency, traces
  providers.py         # STT/LLM/TTS interfaces + fakes; real adapters lazy-import
  telephony_twilio.py  # Twilio signature verify, TwiML, signed stream tokens
  policy/
    intents.py         # deterministic taxonomy (LEASING/MAINTENANCE/EMERGENCY/OTHER/UNKNOWN)
    emergencies.py     # hazard rules + approved safety scripts
    dialogue.py        # constrained FSM; emergency interrupts at any state
    quote_guard.py     # deterministic outbound speech gate (template-only sensitive classes)
    slots.py           # E.164 validation, digit-by-digit readback, confirmation
    render.py          # deterministic summary from validated slots only
  integrations/
    forge.py           # HMAC-signed ingest client (timestamp + nonce, replay guard)
    alerts.py          # emergency dispatcher: concurrent primary voice+SMS, backup, explicit ack
    delivery.py        # idempotent outbox: atomic claim, bounded retry, dead-letter
tests/
  unit/                # policy, quote guard, slots, dialogue, emergency, outbox, migration
  contracts/           # ingest HMAC, Twilio signature, stream tokens, disabled-by-default
  synthetic_calls/     # end-to-end scripted calls, latency (200 turns) + budget
  chaos/               # disconnect, duplicate webhooks, outages, FORGE downtime, restart
  fixtures/synthetic_turns.json
```

## Run

```sh
python3 run_tests.py        # full suite (stdlib unittest; ~80 s, mostly the 200-turn latency leg)
python3 -m app.server       # worker (telephony disabled; /health only until enabled)
```

## Safety invariants (proven by tests, brief §11)

1. Every hazard interrupts at every dialogue state, plays the approved
   safety script first, and starts primary voice + SMS concurrently.
2. SMS-accepted is never human acknowledgment; unanswered/5xx/outage
   triggers bounded Jason backup and a prominent UNACKNOWLEDGED state.
3. Quote/commitment pressure (ballpark, pretend, spelled-out dollars,
   ranges, date promises, prompt injection, tool-error fallback) never
   reaches TTS; the human-callback template plays instead.
4. Callback numbers are read back digit by digit, need explicit
   confirmation, and any correction invalidates the confirmation. ANI is
   never silently substituted.
5. Drafts are PENDING-only until Brandy approves in the Rental Manager
   inbox; approval is version-guarded (exactly-once).
6. Latency is measured end to end on synthetic turns with fake providers
   carrying scripted per-stage latencies — deterministic harness
   measurements, NOT live-call proof (p95 ≤ 800 ms target; the live-call
   bar stays unproven until real telephony trials run); vendor numbers are
   never cited as proof.

## Go-live gates (NOT authorized by this build)

Test number + spend approval, signed-webhook + latency receipts, safety
and failed-alert drills, Brandy inbox rehearsal, attorney-approved AI /
recording wording, emergency-recipient consent, and Jason's explicit
activation word for real inbound calls or forwarding.
