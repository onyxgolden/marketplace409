"""Go-live §6: disclosure revision registry — pinned text, UNAPPROVED draft.

Covers: the only revision is the brief's draft (UNAPPROVED), no revision
is APPROVED, byte-identical verification passes for the pinned text and
fails for any drift/paraphrase, the pinned text equals the v1 dialogue's
fixed disclosure template (the text the TwiML <Say> actually speaks).
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.policy.disclosure import (
    CURRENT_REVISION_ID, current_revision, get_revision,
    is_revision_approved, verify_disclosure_text)
from app.policy.quote_guard import TEMPLATES


class TestDisclosureRegistry(unittest.TestCase):
    def test_only_revision_is_unapproved_draft(self):
        revision = current_revision()
        self.assertEqual(revision["id"], CURRENT_REVISION_ID)
        self.assertEqual(revision["status"], "UNAPPROVED")

    def test_no_revision_is_approved(self):
        self.assertFalse(is_revision_approved(CURRENT_REVISION_ID))
        self.assertFalse(is_revision_approved("does-not-exist"))

    def test_pinned_text_matches_the_twiml_template(self):
        # The registry pins exactly what twiml_start_stream speaks.
        self.assertEqual(current_revision()["text"], TEMPLATES["disclosure"])

    def test_verify_exact_text_passes(self):
        self.assertTrue(verify_disclosure_text(
            CURRENT_REVISION_ID, TEMPLATES["disclosure"]))

    def test_verify_drift_fails(self):
        self.assertFalse(verify_disclosure_text(
            CURRENT_REVISION_ID, TEMPLATES["disclosure"] + " Thanks!"))
        self.assertFalse(verify_disclosure_text(
            CURRENT_REVISION_ID, TEMPLATES["disclosure"].replace("AI assistant", "AI agent")))
        self.assertFalse(verify_disclosure_text("does-not-exist", TEMPLATES["disclosure"]))

    def test_unknown_revision_is_none(self):
        self.assertIsNone(get_revision("does-not-exist"))


if __name__ == "__main__":
    unittest.main()
