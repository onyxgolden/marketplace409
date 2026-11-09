"""Deterministic summary renderer.

Summaries are built ONLY from validated slots and recorded event
timestamps. Unknown stays "not provided", uncertain stays "unverified".
No unconstrained LLM narrative may alter owner-facing facts.
"""
from __future__ import annotations


def render_summary(slots: dict, events: list, call_meta: dict) -> str:
    def _v(key, default="not provided"):
        val = slots.get(key)
        return val if val not in (None, "") else default

    lines = [
        "Brandy receptionist — AI-captured call summary (claims unverified)",
        f"Call: {_v('call_sid')} · started {_v('started_at')} · intent {_v('intent')}",
        f"Caller name (claimed, unverified): {_v('caller_name')}",
        f"Need (caller-stated): {_v('need_description')}",
        f"Callback: {_v('callback_e164')} (confirmed: {slots.get('callback_confirmed', False)})",
        f"Callback source: {_v('callback_source')}",
        f"Property hint (unverified): {_v('property_hint')}",
        f"Emergency type: {_v('emergency_type', 'none')}",
        f"Processing state: {_v('processing_state')}",
    ]
    if slots.get("desired_move_in_window"):
        lines.append(f"Desired move-in window (caller-stated): {slots['desired_move_in_window']}")
    if slots.get("maintenance_location"):
        lines.append(f"Maintenance location (caller-stated): {slots['maintenance_location']}")
    if slots.get("access_preference"):
        lines.append(f"Access preference (caller-stated): {slots['access_preference']}")
    lines.append(f"Events recorded: {len(events)}")
    return "\n".join(lines)
