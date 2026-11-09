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
  config.py            # env config; disabled-by-default gates + go-live ceilings
  activation.py        # signed server-side activation record (OFF/TEST_ONLY/LIVE_APPROVED)
  server.py            # stdlib-only HTTP server (/health, /operator/*, /twilio/*, /alerts/ack)
  session.py           # call lifecycle, append-only events, idempotency, traces, source/cost
  pipeline.py          # live turn: STT -> dialogue -> guardrails -> TTS (+latency/cost)
  media_stream.py      # stdlib WebSocket gateway for Twilio Media Streams
  cost.py              # versioned rate table + durable cost ledger + ceilings
  latency.py           # live-turn latency recorder + percentile receipt
  kill_switch.py       # file-backed kill switch (read fresh every check)
  providers.py         # STT/LLM/TTS interfaces + fakes; REAL Deepgram/OpenAI/Cartesia
                       #   adapters + Pipecat pipeline builder (lazy imports)
  telephony_twilio.py  # Twilio signature verify, TwiML, signed stream tokens,
                       #   human fallback/transfer/voicemail TwiML, media event parsing
  policy/
    disclosure.py      # disclosure revision registry (UNAPPROVED draft only)
    intents.py         # deterministic taxonomy (LEASING/MAINTENANCE/EMERGENCY/OTHER/UNKNOWN)
    emergencies.py     # hazard rules + approved safety scripts
    dialogue.py        # constrained FSM; emergency interrupts at any state
    quote_guard.py     # deterministic outbound speech gate (template-only sensitive classes)
    slots.py           # E.164 validation, digit-by-digit readback, confirmation
    render.py          # deterministic summary from validated slots only
  integrations/
    forge.py           # HMAC-signed ingest client (timestamp + nonce, replay guard)
    alerts.py          # emergency dispatcher + Twilio transport + consent allowlist
    delivery.py        # idempotent outbox + drain worker (live-gated retries)
scripts/
  activation.py        # operator tool: sign/verify the activation record
  recipients.py        # operator tool: consent-gated recipient allowlist
  rollback_drill.py    # preflight, live kill drill, retention audit, receipts
tests/
  unit/                # policy, quote guard, slots, dialogue, emergency, outbox, migration
  contracts/           # ingest HMAC, Twilio signature, stream tokens, disabled-by-default
  synthetic_calls/     # end-to-end scripted calls, latency (200 turns) + budget
  chaos/               # disconnect, duplicate webhooks, outages, FORGE downtime, restart
  golive/              # go-live slice: activation, providers, pipeline, media,
                       #   cost, kill switch, alerts transport, rollback drill
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

## Go-live slice (built 2026-11-08; NOT activated)

The go-live slice wires the real providers and the activation machinery
behind the gates above. Mode stays OFF until the operator signs an
activation record (`scripts/activation.py`) with
`RECEPTIONIST_ACTIVATION_SECRET`:

- **Activation** (`app/activation.py`): the effective mode comes ONLY
  from the HMAC-signed server-side record. `TEST_ONLY` requires the
  record's test number to match the deployment env. `LIVE_APPROVED`
  additionally requires a recorded owner word, non-empty rehearsal
  receipts, and an attorney-APPROVED disclosure revision — no revision
  is APPROVED in this build, so LIVE_APPROVED cannot validate today.
- **Real providers** (`app/providers.py`): Deepgram Nova-3 streaming
  STT, GPT-4o-mini-class LLM, Cartesia Sonic TTS, Pipecat pipeline
  builder. Lazy imports, bounded timeouts, circuit breakers, error
  taxonomy. The LLM is advisory-only in this slice: it never speaks
  directly — the dialogue's fixed templates speak, and the LLM text is
  recorded for rehearsal evaluation.
- **Media Streams** (`app/media_stream.py`): stdlib WebSocket gateway
  (handshake, frames, ping/pong). Signed stream-token validation on
  `start`, sequence/timestamp gap tracking, barge-in (`clear` +
  paced-audio drop), reconnect-resume on the same call SID, safe close
  on drop (session ends INCOMPLETE, never a phantom record).
- **Kill switch** (`app/kill_switch.py` + `POST /operator/kill`): file
  state read fresh on every check; engaging it ends live sessions
  immediately and routes new calls to the Twilio-level human
  voicemail/forwarding fallback (which works when the worker is down).
- **Cost** (`app/cost.py`): rate table v1.0 from the Nov 8 teardown
  (~$0.04/min all-in planning number); per-call ledger + per-call and
  campaign HARD ceilings checked before provider sessions and expensive
  actions; exhaustion fails closed to human voicemail + operator alert.
- **Consent/disclosure** (`app/policy/disclosure.py`): the disclosure
  revision registry pins the exact v1 disclosure text; the pipeline
  verifies it byte-identical before TTS. The only revision is the
  brief's draft, marked UNAPPROVED — attorney wording does not exist
  yet. Consent/refusal paths live in the dialogue; recordings + raw
  transcript storage stay OFF by default.
- **Emergency alerts** (`app/integrations/alerts.py`): real Twilio
  voice+SMS transport behind the dispatcher's live gate (mode/kill/
  flag) and a consent-gated recipient allowlist
  (`scripts/recipients.py`). No consent exists yet, so no real
  recipient is wired and every send fails closed with
  `no_consented_recipient`. Provider accepted/sent/delivered is never
  a human ACK — only authenticated operator action or Twilio-signed
  DTMF tied to a recorded attempt.
- **Operator inbox**: call history with TEST/LIVE/SYNTHETIC labels,
  consent, per-call cost, alert timeline (including REFUSED with the
  reason), kill switch panel (`KILL` button), and rollback status
  (`src/app/api/rental/receptionist/status`, `.../operator/kill`).
- **Migration** (`supabase/migrations/20261108230000_brandy_receptionist_golive.sql`,
  FILE ONLY — not applied): additive columns on calls (`source`,
  `cost_estimate_usd`, `cost_rate_version`) and alerts
  (`refused_reason`, `resolution_state` CHECK widened to admit
  `REFUSED`). No grants, no RLS changes, idempotent.
- **Rollback drill** (`scripts/rollback_drill.py`): `preflight`
  (read-only), `drill` (live kill against a running server),
  `retention-audit`, `receipt` (redacted JSON evidence).

## Go-live gates (NOT authorized by this build)

Test number + spend approval, signed-webhook + latency receipts, safety
and failed-alert drills, Brandy inbox rehearsal, attorney-approved AI /
recording wording, emergency-recipient consent, and Jason's explicit
activation word for real inbound calls or forwarding.
