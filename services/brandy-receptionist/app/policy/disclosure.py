"""Disclosure revisions (go-live §6).

The opening AI-identity + may-be-recorded/transcribed disclosure plays
the EXACT approved revision — never a paraphrase, never a newer draft.
Each revision is pinned by id and text; the TTS layer must verify the
revision before speaking it (see app/pipeline.py).

ATTORNEY-APPROVED WORDING DOES NOT EXIST YET. The only revision in this
build is the brief's draft, marked UNAPPROVED. It may be used for
synthetic rehearsal ONLY, and every surface that renders it must label it
UNAPPROVED. Presenting it as approved is a defect. When the attorney
blesses wording, a new revision is added here with status APPROVED and
the activation record for LIVE_APPROVED names that revision id.
"""
from __future__ import annotations

# The pinned text is the v1 dialogue's fixed disclosure template, verbatim
# (quote_guard.TEMPLATES["disclosure"]) — it is what the service actually
# says today. It is the brief's draft wording, NOT attorney-approved.
# Do not quote it to a caller as if it were approved.
DRAFT_DISCLOSURE_EN = (
    "Hello, you've reached Brandy's rental office. I'm an AI assistant. "
    "This call may be transcribed to help Brandy follow up. If you'd "
    "prefer a person, I can take a message for her."
)

REVISIONS = {
    "draft-2026-11-08": {
        "id": "draft-2026-11-08",
        "status": "UNAPPROVED",  # brief draft only — attorney review pending
        "language": "en",
        "text": DRAFT_DISCLOSURE_EN,
        "source": "v1 fixed template quote_guard.TEMPLATES['disclosure'] — brief draft wording, attorney review pending",
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

# The revision the server plays today. UNAPPROVED by construction: the
# service is OFF / synthetic-only until the attorney blesses a revision.
CURRENT_REVISION_ID = "draft-2026-11-08"


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
