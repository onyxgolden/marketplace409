# Offline egress-disabled boundary test — human-controlled, not a builder step

Per PR #820 fix round 2 (ChatGPT re-review, 2026-11-16): the Python-level `HF_HUB_OFFLINE`/
`TRANSFORMERS_OFFLINE` enforcement in `local_inference/server.py`'s `_enforce_offline_env()`,
and the cache-miss fail-closed tests in `tests/unit/test_local_inference_security.py`, prove
that the **library code asks for no network when those env vars are set**. They do **not**
prove the fully initialized runtime (Python interpreter + every C extension/driver it loads —
CUDA, cuDNN, torch, onnxruntime, Kokoro's own dependencies) never attempts *any* outbound
connection on its own, for any reason, at any point from process start to serving `/health`.

That gap is a real one, and closing it requires disabling network egress at the OS/firewall
level — a system-settings change I will not make myself (see the standing rule: Claude never
modifies system or security settings autonomously). This is the exact rehearsal to run it.

## Procedure

Run this on the machine that will actually run the receptionist's local inference server.

1. **Record the starting state.** Note whether the server has ever been started successfully
   before (so its model caches already exist on disk — HF cache dir, any ONNX/torch compiled
   kernel cache). A FIRST-EVER run with egress disabled will correctly fail if a model isn't
   pre-cached — that's not a bug, it's the fail-closed behavior working. Run the server once
   normally (network enabled) first if it has never been started, so the caches are warm.

2. **Disable outbound network egress for this host**, keeping loopback (127.0.0.1) available.
   Any of these work; pick whichever matches how this machine is actually isolated:
   - Physically disconnect the network adapter (Wi-Fi off / Ethernet unplugged) — simplest,
     least ambiguous, no firewall rule to remember to remove afterward.
   - A temporary Windows Firewall outbound rule blocking all addresses except
     `127.0.0.1`/`::1` for the specific processes (or system-wide, for the duration of this
     test only). Loopback must stay open — this service's own HTTP calls from the adapter in
     `app/providers.py` to `local_inference/server.py` and to Ollama are both loopback-only
     already (enforced by `validate_loopback_url`), so a loopback-only firewall rule does not
     interfere with the service itself at all.

3. **Start `local_inference/server.py` fresh** (new process, not reusing an already-running
   one — a running process may have already resolved/cached things in memory before egress
   was disabled):
   ```
   "C:\Users\jason\AppData\Local\Programs\Python\Python312\python.exe" local_inference\server.py
   ```

4. **Check `/health`** (loopback, so this works even with egress disabled):
   ```
   curl -s http://127.0.0.1:8809/health
   ```
   Expect `"sttReady": true, "kokoroReady": true` (cached models load fine with no network) —
   or, if a model is NOT pre-cached, a clean `sttError`/`kokoroError` naming the missing asset,
   never a silent attempt to download it.

5. **Run a real STT + TTS round trip** (loopback), exactly as the Cut 1 test scripts already do:
   ```
   "C:\Users\jason\AppData\Local\Programs\Python\Python312\python.exe" -c "
   import sys; sys.path.insert(0, 'services/brandy-receptionist')
   from app.config import ReceptionistConfig, ensure_local_inference_token
   from app.providers import local_stt, local_tts
   config = ReceptionistConfig(local_inference_enabled=True)
   tts = local_tts(config)
   r = tts.synthesize('Testing offline boundary.')
   print('tts ok, bytes:', len(r['audio']))
   stt = local_stt(config)
   r2 = stt.transcribe_chunk(r['audio'])
   print('stt ok, text:', r2['text'])
   "
   ```

6. **Run a local Ollama advisory request** too (also loopback):
   ```
   "C:\Users\jason\AppData\Local\Programs\Python\Python312\python.exe" -c "
   import sys; sys.path.insert(0, 'services/brandy-receptionist')
   from app.config import ReceptionistConfig
   from app.providers import local_llm
   config = ReceptionistConfig(local_inference_enabled=True)
   llm = local_llm(config)
   r = llm.respond(state='TEST', response_class='ask_slot', history=[{'role': 'user', 'content': 'hello'}])
   print('llm ok:', r['text'][:80])
   "
   ```
   Ollama itself must also be running with egress disabled for this step — if the egress
   rule is system-wide it already covers Ollama's own process; if it is scoped to specific
   processes, include Ollama's `ollama.exe`/`ollama_llama_server.exe` in the block list too.

7. **Record the result**, in whichever of the two shapes actually happened:
   - **All of the above succeeded with egress disabled**: this is the proof. Record the exact
     steps taken to disable egress (firewall rule text or "physically disconnected"), the
     `/health` response, and the STT/TTS/LLM outputs. This closes the offline-boundary gate.
   - **Something failed**: read the failure carefully before concluding anything.
     - A clean, named "model not found in cache" / "could not load X" error is the SYSTEM
       correctly refusing to fall back to a download — that is success for THIS gate (proves
       no silent network fallback), but reveals a missing pre-provisioning step (the model
       needs to be cached BEFORE egress is disabled in production). Fix the pre-provisioning,
       not the offline enforcement.
     - A timeout, DNS failure, or connection-refused error pointing at a NON-loopback address
       is the real finding this test exists to catch: something in the stack attempted
       external egress. Capture exactly which call failed (the traceback names the host it
       tried to reach) — that is a concrete, actionable defect to fix, not a pass/fail label
       on this document.

8. **Restore normal network settings** when done (re-enable the adapter / remove the
   temporary firewall rule).

## What this test does NOT cover

- It does not prove there is no network attempt that happens to succeed AND would also
  succeed if silently redirected somewhere unintended (egress disabled only proves "no
  network reachable," not "no network attempted and ignored the failure gracefully" vs.
  "no network attempted at all" — a packet capture during a NORMAL, network-enabled run would
  be needed to distinguish those, which is a separate, more invasive test not requested here).
- It is Stage 0 scope only — no SIP/telephony leg exists yet in this cut.
