"""Go-live §6 + local-build Cut 1 §2: disclosure revision registry.

Cut 1 (2026-11-16) pins the exact production wording Jason supplied
directly in the local-build scope brief — no attorney sign-off, no LLM
paraphrase. Covers: the current revision is this pinned wording and is
APPROVED, byte-identical AND hash verification pass for it and fail for
any drift/paraphrase, the pinned text equals the v1 dialogue's fixed
disclosure template (the text actually spoken), and the superseded
brief-draft revision remains UNAPPROVED history, not a current option.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.policy.disclosure import (
    CURRENT_REVISION_ID, PINNED_DISCLOSURE_EN, current_revision, get_revision,
    is_revision_approved, verify_disclosure_hash, verify_disclosure_text)
from app.policy.quote_guard import TEMPLATES


class TestDisclosureRegistry(unittest.TestCase):
    def test_current_revision_is_the_pinned_approved_wording(self):
        revision = current_revision()
        self.assertEqual(revision["id"], CURRENT_REVISION_ID)
        self.assertEqual(revision["id"], "pinned-2026-11-16")
        self.assertEqual(revision["status"], "APPROVED")
        self.assertEqual(revision["text"], PINNED_DISCLOSURE_EN)

    def test_current_revision_is_approved_and_unknown_revision_is_not(self):
        self.assertTrue(is_revision_approved(CURRENT_REVISION_ID))
        self.assertFalse(is_revision_approved("does-not-exist"))

    def test_superseded_draft_revision_stays_unapproved(self):
        # Cut 1 keeps the old brief-draft revision for history; it must
        # never become usable again without a fresh explicit decision.
        draft = get_revision("draft-2026-11-08")
        self.assertIsNotNone(draft)
        self.assertEqual(draft["status"], "UNAPPROVED")
        self.assertFalse(is_revision_approved("draft-2026-11-08"))

    def test_pinned_text_matches_the_spoken_template_exactly(self):
        # The registry pins exactly what the dialogue FSM's "disclosure"
        # response class speaks — byte-for-byte, no paraphrase.
        self.assertEqual(current_revision()["text"], TEMPLATES["disclosure"])
        self.assertEqual(TEMPLATES["disclosure"],
                          "You're speaking with an AI assistant, and this call may be recorded.")

    def test_verify_exact_text_passes(self):
        self.assertTrue(verify_disclosure_text(
            CURRENT_REVISION_ID, TEMPLATES["disclosure"]))

    def test_verify_drift_fails(self):
        self.assertFalse(verify_disclosure_text(
            CURRENT_REVISION_ID, TEMPLATES["disclosure"] + " Thanks!"))
        self.assertFalse(verify_disclosure_text(
            CURRENT_REVISION_ID, TEMPLATES["disclosure"].replace("AI assistant", "AI agent")))
        self.assertFalse(verify_disclosure_text("does-not-exist", TEMPLATES["disclosure"]))

    def test_verify_hash_passes_for_the_exact_pinned_text(self):
        # Cut 1 adds the hash check (§2: "a revision id/hash verified
        # before first audio") alongside the existing text check.
        self.assertTrue(verify_disclosure_hash(CURRENT_REVISION_ID, TEMPLATES["disclosure"]))

    def test_verify_hash_fails_for_any_drift(self):
        self.assertFalse(verify_disclosure_hash(
            CURRENT_REVISION_ID, TEMPLATES["disclosure"] + " "))
        self.assertFalse(verify_disclosure_hash("does-not-exist", TEMPLATES["disclosure"]))

    def test_unknown_revision_is_none(self):
        self.assertIsNone(get_revision("does-not-exist"))


if __name__ == "__main__":
    unittest.main()
