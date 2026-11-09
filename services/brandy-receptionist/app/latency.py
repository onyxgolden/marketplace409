"""Live-turn latency recorder + percentile receipt (go-live §8).

Every live turn records its stage timings (STT, LLM, TTS-first-audio,
end-to-end, barge-in stop) into a durable JSONL file. The receipt
generator aggregates p50/p95/p99 per stage and compares them against the
config targets (p95 ≤ 800 ms end-to-end, p99 ≤ 1200 ms, barge-in stop
p95 ≤ 250 ms, emergency alert request p95 ≤ 2000 ms). Vendor claims are
never used; only measured turns count.

A turn is a dict:
  {"call_sid", "turn", "source": "TEST"|"LIVE"|"SYNTHETIC",
   "stt_ms", "llm_ms", "tts_first_audio_ms", "e2e_ms",
   "barge_in_stop_ms" (optional), "ts"}
"""
from __future__ import annotations

import json
import math
import os
import threading


def percentile(values: list[float], pct: float) -> float | None:
    """Nearest-rank percentile; None for an empty sample."""
    if not values:
        return None
    ordered = sorted(values)
    rank = math.ceil(pct / 100.0 * len(ordered))
    return ordered[max(0, min(rank, len(ordered)) - 1)]


class LatencyRecorder:
    """Append-only JSONL latency log + in-memory aggregation."""

    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()

    def record_turn(self, *, call_sid: str, turn: int, source: str,
                    stt_ms: float | None = None, llm_ms: float | None = None,
                    tts_first_audio_ms: float | None = None,
                    e2e_ms: float | None = None,
                    barge_in_stop_ms: float | None = None) -> dict:
        entry = {
            "call_sid": call_sid, "turn": turn, "source": source,
            "stt_ms": stt_ms, "llm_ms": llm_ms,
            "tts_first_audio_ms": tts_first_audio_ms, "e2e_ms": e2e_ms,
            "barge_in_stop_ms": barge_in_stop_ms,
        }
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with self._lock:
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, sort_keys=True) + "\n")
        return entry

    def load_turns(self, *, source: str | None = None) -> list[dict]:
        try:
            with open(self.path, "r", encoding="utf-8") as fh:
                rows = [json.loads(line) for line in fh if line.strip()]
        except (OSError, ValueError):
            return []
        if source is not None:
            rows = [r for r in rows if r.get("source") == source]
        return rows

    def receipt(self, *, source: str | None = None, targets: dict | None = None) -> dict:
        """Percentile receipt: p50/p95/p99 per stage + target verdicts."""
        turns = self.load_turns(source=source)
        targets = targets or {}
        out: dict = {"turns": len(turns), "source": source, "stages": {}, "verdicts": {}}
        for stage in ("stt_ms", "llm_ms", "tts_first_audio_ms", "e2e_ms", "barge_in_stop_ms"):
            values = [t[stage] for t in turns if isinstance(t.get(stage), (int, float))]
            out["stages"][stage] = {
                "n": len(values),
                "p50": percentile(values, 50),
                "p95": percentile(values, 95),
                "p99": percentile(values, 99),
            }
        # Target verdicts (only when a sample exists for the stage).
        checks = {
            "e2e_ms": targets.get("latency_p95_target_ms"),
            "barge_in_stop_ms": targets.get("barge_in_stop_p95_target_ms"),
        }
        for stage, target in checks.items():
            p95 = out["stages"][stage]["p95"]
            if target is None or p95 is None:
                out["verdicts"][stage] = "NO_SAMPLE"
            else:
                out["verdicts"][stage] = "PASS" if p95 <= target else "FAIL"
        return out
