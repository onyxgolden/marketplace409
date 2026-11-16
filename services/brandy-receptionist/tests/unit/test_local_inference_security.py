"""Receptionist Cut 1 fix round 1 (P1/P2): local_inference/server.py's
request-validation and approval-signing primitives. Pure-function tests
only — no real HTTP server, no model loading (importing `server` module-
level costs nothing but stdlib; every ML import inside it is lazy).
"""
import hashlib
import hmac
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from local_inference.server import (  # noqa: E402
    EXPECTED_HOST_HEADER,
    REQUIRED_OPENVOICE_PURPOSE,
    REQUIRED_OPENVOICE_SPEAKER,
    reject_hostile_origin,
    require_auth,
)
from app.config import validate_loopback_url, read_local_inference_token, ensure_local_inference_token  # noqa: E402
from app.config import ReceptionistConfig  # noqa: E402


class TestRejectHostileOrigin(unittest.TestCase):
    def test_accepts_a_well_formed_local_request(self):
        headers = {"Host": EXPECTED_HOST_HEADER}
        self.assertIsNone(reject_hostile_origin(headers))

    def test_rejects_a_wrong_host_header(self):
        headers = {"Host": "evil.example.com:8809"}
        self.assertIsNotNone(reject_hostile_origin(headers))

    def test_rejects_any_request_carrying_an_origin_header(self):
        # Presence alone is the signal — even a same-looking Origin.
        headers = {"Host": EXPECTED_HOST_HEADER, "Origin": f"http://{EXPECTED_HOST_HEADER}"}
        reason = reject_hostile_origin(headers)
        self.assertIsNotNone(reason)
        self.assertIn("Origin", reason)

    def test_rejects_a_hostile_origin_header(self):
        headers = {"Host": EXPECTED_HOST_HEADER, "Origin": "http://evil.example.com"}
        self.assertIsNotNone(reject_hostile_origin(headers))

    def test_rejects_a_cross_site_sec_fetch_site(self):
        headers = {"Host": EXPECTED_HOST_HEADER, "Sec-Fetch-Site": "cross-site"}
        self.assertIsNotNone(reject_hostile_origin(headers))

    def test_accepts_same_origin_sec_fetch_site(self):
        headers = {"Host": EXPECTED_HOST_HEADER, "Sec-Fetch-Site": "same-origin"}
        self.assertIsNone(reject_hostile_origin(headers))

    def test_rejects_same_site_sec_fetch_site(self):
        # "same-site" (a different subdomain/port under the registrable
        # domain) is still not "same-origin" — must be rejected too.
        headers = {"Host": EXPECTED_HOST_HEADER, "Sec-Fetch-Site": "same-site"}
        self.assertIsNotNone(reject_hostile_origin(headers))


class TestRequireAuth(unittest.TestCase):
    def test_accepts_the_correct_bearer_token(self):
        headers = {"Authorization": "Bearer correct-token"}
        self.assertIsNone(require_auth(headers, "correct-token"))

    def test_rejects_a_missing_authorization_header(self):
        self.assertIsNotNone(require_auth({}, "correct-token"))

    def test_rejects_a_wrong_token(self):
        headers = {"Authorization": "Bearer wrong-token"}
        self.assertIsNotNone(require_auth(headers, "correct-token"))

    def test_rejects_a_non_bearer_scheme(self):
        headers = {"Authorization": "Basic correct-token"}
        self.assertIsNotNone(require_auth(headers, "correct-token"))


class TestValidateLoopbackUrl(unittest.TestCase):
    def test_accepts_127_0_0_1(self):
        validate_loopback_url("http://127.0.0.1:8809", label="x")  # no raise

    def test_accepts_localhost(self):
        validate_loopback_url("http://localhost:11434", label="x")  # no raise

    def test_rejects_https(self):
        with self.assertRaises(ValueError):
            validate_loopback_url("https://127.0.0.1:8809", label="x")

    def test_rejects_a_remote_hostname(self):
        with self.assertRaises(ValueError):
            validate_loopback_url("http://evil.example.com:8809", label="x")

    def test_rejects_a_path(self):
        with self.assertRaises(ValueError):
            validate_loopback_url("http://127.0.0.1:8809/stt", label="x")

    def test_rejects_userinfo(self):
        with self.assertRaises(ValueError):
            validate_loopback_url("http://user:pass@127.0.0.1:8809", label="x")

    def test_rejects_a_query_string(self):
        with self.assertRaises(ValueError):
            validate_loopback_url("http://127.0.0.1:8809?x=1", label="x")

    def test_rejects_a_dns_name_that_merely_resolves_to_loopback(self):
        # Only the literal address strings are accepted — a hostname
        # could resolve differently later (DNS rebinding).
        with self.assertRaises(ValueError):
            validate_loopback_url("http://loopback.example.com:8809", label="x")


class TestLocalInferenceTokenResolution(unittest.TestCase):
    def test_env_value_takes_precedence_over_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_path = os.path.join(tmp, "token.txt")
            with open(token_path, "w", encoding="utf-8") as fh:
                fh.write("file-token")
            config = ReceptionistConfig(local_inference_auth_token="env-token", local_inference_auth_token_path=token_path)
            self.assertEqual(read_local_inference_token(config), "env-token")

    def test_client_reads_the_servers_persisted_file_when_no_env_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_path = os.path.join(tmp, "token.txt")
            with open(token_path, "w", encoding="utf-8") as fh:
                fh.write("server-generated-token")
            config = ReceptionistConfig(local_inference_auth_token="", local_inference_auth_token_path=token_path)
            self.assertEqual(read_local_inference_token(config), "server-generated-token")

    def test_client_read_returns_empty_when_neither_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = ReceptionistConfig(local_inference_auth_token="", local_inference_auth_token_path=os.path.join(tmp, "missing.txt"))
            self.assertEqual(read_local_inference_token(config), "")

    def test_server_generates_and_persists_a_token_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_path = os.path.join(tmp, "nested", "token.txt")
            config = ReceptionistConfig(local_inference_auth_token="", local_inference_auth_token_path=token_path)
            generated = ensure_local_inference_token(config)
            self.assertTrue(generated)
            self.assertTrue(os.path.exists(token_path))
            # A second call reuses the same persisted token, never
            # regenerates — both server restarts and the client must
            # agree on a stable value.
            self.assertEqual(ensure_local_inference_token(config), generated)


class TestOpenVoiceApprovalIsASignedRecordNotAForgeableFile(unittest.TestCase):
    def _sign(self, record: dict, secret: str) -> dict:
        body = dict(record)
        sig = hmac.new(secret.encode("utf-8"), json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8"), hashlib.sha256).hexdigest()
        body["signature"] = sig
        return body

    def test_a_literal_approved_text_file_is_no_longer_sufficient(self):
        # Fix round 1, P2's own regression: the OLD gate accepted any
        # file containing exactly "APPROVED". Writing that same literal
        # text as a "record" with no signature must now be rejected.
        import local_inference.server as server_mod

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "approval.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("APPROVED")
            old_path, old_secret = server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET
            server_mod.OPENVOICE_APPROVAL_RECORD_PATH = path
            server_mod.OPENVOICE_APPROVAL_SECRET = "test-secret"
            try:
                ok, reason = server_mod.verify_openvoice_approval()
                self.assertFalse(ok)
            finally:
                server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET = old_path, old_secret

    def test_a_correctly_signed_in_scope_unexpired_record_is_approved(self):
        import local_inference.server as server_mod

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "approval.json")
            record = self._sign({
                "purpose": REQUIRED_OPENVOICE_PURPOSE, "speaker": REQUIRED_OPENVOICE_SPEAKER,
                "approvedBy": "jason", "decisionAt": "2026-11-16T00:00:00Z",
            }, "test-secret")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(record, fh)
            old_path, old_secret = server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET
            server_mod.OPENVOICE_APPROVAL_RECORD_PATH = path
            server_mod.OPENVOICE_APPROVAL_SECRET = "test-secret"
            try:
                ok, reason = server_mod.verify_openvoice_approval()
                self.assertTrue(ok, reason)
            finally:
                server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET = old_path, old_secret

    def test_a_tampered_record_is_rejected(self):
        import local_inference.server as server_mod

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "approval.json")
            record = self._sign({
                "purpose": REQUIRED_OPENVOICE_PURPOSE, "speaker": REQUIRED_OPENVOICE_SPEAKER,
                "approvedBy": "jason", "decisionAt": "2026-11-16T00:00:00Z",
            }, "test-secret")
            record["speaker"] = "someone-else"  # tamper after signing
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(record, fh)
            old_path, old_secret = server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET
            server_mod.OPENVOICE_APPROVAL_RECORD_PATH = path
            server_mod.OPENVOICE_APPROVAL_SECRET = "test-secret"
            try:
                ok, reason = server_mod.verify_openvoice_approval()
                self.assertFalse(ok)
            finally:
                server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET = old_path, old_secret

    def test_an_expired_record_is_rejected(self):
        import local_inference.server as server_mod

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "approval.json")
            record = self._sign({
                "purpose": REQUIRED_OPENVOICE_PURPOSE, "speaker": REQUIRED_OPENVOICE_SPEAKER,
                "approvedBy": "jason", "decisionAt": "2020-01-01T00:00:00Z", "expiresAt": "2020-02-01T00:00:00Z",
            }, "test-secret")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(record, fh)
            old_path, old_secret = server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET
            server_mod.OPENVOICE_APPROVAL_RECORD_PATH = path
            server_mod.OPENVOICE_APPROVAL_SECRET = "test-secret"
            try:
                ok, reason = server_mod.verify_openvoice_approval()
                self.assertFalse(ok)
                self.assertIn("expired", reason)
            finally:
                server_mod.OPENVOICE_APPROVAL_RECORD_PATH, server_mod.OPENVOICE_APPROVAL_SECRET = old_path, old_secret

    def test_no_secret_configured_means_never_approved(self):
        import local_inference.server as server_mod

        old_secret = server_mod.OPENVOICE_APPROVAL_SECRET
        server_mod.OPENVOICE_APPROVAL_SECRET = ""
        try:
            ok, reason = server_mod.verify_openvoice_approval()
            self.assertFalse(ok)
        finally:
            server_mod.OPENVOICE_APPROVAL_SECRET = old_secret


if __name__ == "__main__":
    unittest.main()
