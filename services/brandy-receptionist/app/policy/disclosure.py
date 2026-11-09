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
