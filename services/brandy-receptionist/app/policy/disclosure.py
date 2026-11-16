"""Disclosure revisions (go-live §6; local-build Cut 1 §2 pinned swap).

The opening AI-identity + may-be-recorded/transcribed disclosure plays
the EXACT approved revision — never a paraphrase, never a newer draft,
never an LLM rewrite. Each revision is pinned by id, text AND a SHA-256
of the text; the TTS layer must verify both the revision id and the
hash before speaking it (see app/pipeline.py), byte-for-byte.

Cut 1 (2026-11-16, `commands/claude/receptionist-local-build-cut1-2026-11-16.md`)
removes the attorney-approval DEPENDENCY: Jason's own direct word in the
local-build scope brief supplies the exact pinned production wording
below (`PINNED_REVISION_ID`), so LIVE_APPROVED no longer waits on an
attorney sign-off to have any approved revision to name. This does not
remove any OTHER go-live gate — owner_word, rehearsal_receipts, and
every other activation.py check still apply unchanged; only the
specific "no revision is APPROVED in this build" blocker is lifted.
The original brief-draft revision below is kept for history and stays
UNAPPROVED (superseded by the pinned wording, not deleted).
"""
from __future__ import annotations

import hashlib

# The pinned text is the v1 dialogue's fixed disclosure template, verbatim
# (quote_guard.TEMPLATES["disclosure"]) — it is what the service actually
# said before Cut 1. Brief draft wording, never approved; superseded by
# PINNED_DISCLOSURE_EN below. Kept here only as a historical record —
# do not quote it to a caller as if it were approved or current.
DRAFT_DISCLOSURE_EN = (
    "Hello, you've reached Brandy's rental office. I'm an AI assistant. "
    "This call may be transcribed to help Brandy follow up. If you'd "
    "prefer a person, I can take a message for her."
)

# Cut 1's pinned production wording — Jason's own exact words in the
# local-build scope brief (`results/chatgpt/receptionist-local-build-scope-2026-11-16.md`
# §1), byte-for-byte. This is what current_revision() returns once this
# is CURRENT_REVISION_ID below.
PINNED_DISCLOSURE_EN = "You're speaking with an AI assistant, and this call may be recorded."


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


REVISIONS = {
    "draft-2026-11-08": {
        "id": "draft-2026-11-08",
        "status": "UNAPPROVED",  # superseded by pinned-2026-11-16; kept for history
        "language": "en",
        "text": DRAFT_DISCLOSURE_EN,
        "sha256": _sha256_hex(DRAFT_DISCLOSURE_EN),
        "source": "v1 fixed template quote_guard.TEMPLATES['disclosure'] — brief draft wording, superseded",
    },
    "pinned-2026-11-16": {
        "id": "pinned-2026-11-16",
        "status": "APPROVED",  # Jason's own direct word, not an attorney sign-off
        "language": "en",
        "text": PINNED_DISCLOSURE_EN,
        "sha256": _sha256_hex(PINNED_DISCLOSURE_EN),
        "source": "Jason's own exact pinned wording, receptionist-local-build-scope-2026-11-16.md §1 — no LLM paraphrase, no attorney gate",
    },
}

# --- Voicemail recordings: a SEPARATE policy from the AI call disclosure --
#
# A Twilio <Record> in the human-voicemail fallback is an AUDIO RECORDING
# of the caller, even with transcribe="false" (that flag disables
# transcription, not recording). The go-live scope keeps recordings OFF
# by default and requires approved disclosure/retention before real
# calls — so a voicemail recording needs its OWN approved disclosure,
# storage/retention decision, and test-number routing before the
# fallback may record anyone (fix round 1, P2-2).
#
# No attorney-approved voicemail wording exists yet: the policy below
# is UNAPPROVED and the fallback renders NO <Record> until BOTH the
# policy is APPROVED (attorney-blessed wording replaces this draft)
# AND the operator enables it (config.voicemail_recording_enabled).
# Until then the fallback offers a human transfer when one is
# configured, and otherwise tells the caller to call back — it never
# records.
VOICEMAIL_RECORDING_POLICY = {
    "id": "voicemail-recording-2026-11-08",
    "status": "UNAPPROVED",  # draft wording — attorney review pending
    "language": "en",
    # Draft wording, spoken immediately before <Record> once approved.
    # Do NOT present it to a caller as approved while UNAPPROVED.
    "text": ("Brandy's rental office. Your message will be recorded as a "
             "voicemail so Brandy can call you back. If you do not want "
             "your message recorded, please hang up and call again during "
             "office hours."),
    "source": "draft wording for attorney review — NOT approved",
}


def voicemail_recording_approved() -> bool:
    """True only when an attorney-approved voicemail-recording disclosure
    exists. The fallback TwiML checks this itself, so a caller can never
    be recorded on a draft policy even if the config flag is on."""
    return VOICEMAIL_RECORDING_POLICY["status"] == "APPROVED"

# The revision the server plays today. Cut 1 pins this to the APPROVED
# wording above — no env flag, no LLM, no human in this process can
# change what gets spoken without editing this file.
CURRENT_REVISION_ID = "pinned-2026-11-16"


def get_revision(revision_id: str) -> dict | None:
    return REVISIONS.get(revision_id)


def is_revision_approved(revision_id: str) -> bool:
    rev = REVISIONS.get(revision_id)
    return bool(rev) and rev["status"] == "APPROVED"


def current_revision() -> dict:
    return REVISIONS[CURRENT_REVISION_ID]


def verify_disclosure_text(revision_id: str, text: str) -> bool:
    """True only when the text is byte-identical to the pinned revision.

    The TTS layer calls this before speaking the disclosure. A mismatch
    (drift, paraphrase, wrong revision) must block the disclosure and
    fail the call closed to human fallback.
    """
    rev = REVISIONS.get(revision_id)
    return bool(rev) and rev["text"] == text


def verify_disclosure_hash(revision_id: str, text: str) -> bool:
    """True only when the text's SHA-256 matches the pinned revision's
    hash — the stronger, Cut 1-added check ("a revision id/hash verified
    before first audio"): a mismatch here means the on-disk/in-memory
    text was tampered with or drifted even if some caller still passes
    the same literal string `verify_disclosure_text` would accept."""
    rev = REVISIONS.get(revision_id)
    return bool(rev) and rev.get("sha256") == _sha256_hex(text)
