"""Receptionist Cut 1 item 4: recording + evidence bundle contract
(app/recording.py). See brief §6.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.config import DisabledError, ReceptionistConfig
from app.recording import (
    RecordingSession,
    TranscriptSegment,
    ani_lookup_key,
    decrypt_bytes,
    decrypt_bytes_any_key,
    decrypt_transcript,
    delete_bundle,
    encrypt_bytes,
    load_manifest,
    rotate_bundle_key,
    sha256_hex,
)

try:
    from cryptography.fernet import Fernet

    HAVE_CRYPTO = True
except ImportError:
    HAVE_CRYPTO = False

REAL_KEY = Fernet.generate_key().decode("ascii") if HAVE_CRYPTO else "unused"
REAL_KEY_2 = Fernet.generate_key().decode("ascii") if HAVE_CRYPTO else "unused2"


def _config(tmp, **overrides):
    kwargs = {
        "recording_enabled": True,
        "recording_storage_path": tmp,
        "recording_encryption_keys_json": json.dumps({"k1": REAL_KEY}),
        "recording_current_key_id": "k1",
        "recording_index_secret": "test-index-secret",
    }
    kwargs.update(overrides)
    return ReceptionistConfig(**kwargs)


class TestAniLookupKey(unittest.TestCase):
    def test_same_number_hashes_the_same(self):
        a = ani_lookup_key("+15552345678", "secret")
        b = ani_lookup_key("+15552345678", "secret")
        self.assertEqual(a, b)

    def test_different_numbers_hash_differently(self):
        a = ani_lookup_key("+15552345678", "secret")
        b = ani_lookup_key("+15559998888", "secret")
        self.assertNotEqual(a, b)

    def test_withheld_ani_gets_its_own_fixed_bucket(self):
        self.assertEqual(ani_lookup_key("", "secret"), "withheld")
        self.assertEqual(ani_lookup_key(None, "secret"), "withheld")

    def test_the_raw_number_never_appears_in_the_key(self):
        key = ani_lookup_key("+15552345678", "secret")
        self.assertNotIn("5552345678", key)
        self.assertNotIn("2345678", key)

    def test_refuses_to_hash_with_an_empty_secret(self):
        with self.assertRaises(ValueError):
            ani_lookup_key("+15552345678", "")

    def test_different_secrets_produce_different_keys_for_the_same_number(self):
        a = ani_lookup_key("+15552345678", "secret-one")
        b = ani_lookup_key("+15552345678", "secret-two")
        self.assertNotEqual(a, b)


@unittest.skipUnless(HAVE_CRYPTO, "cryptography not installed")
class TestEncryptDecrypt(unittest.TestCase):
    def test_round_trips_exactly(self):
        token = encrypt_bytes(b"hello world", REAL_KEY)
        self.assertEqual(decrypt_bytes(token, REAL_KEY), b"hello world")

    def test_ciphertext_does_not_contain_the_plaintext(self):
        token = encrypt_bytes(b"super secret caller content", REAL_KEY)
        self.assertNotIn(b"super secret caller content", token)

    def test_wrong_key_fails_to_decrypt(self):
        other_key = Fernet.generate_key().decode("ascii")
        token = encrypt_bytes(b"data", REAL_KEY)
        with self.assertRaises(Exception):
            decrypt_bytes(token, other_key)

    def test_refuses_to_encrypt_with_no_key(self):
        with self.assertRaises(ValueError):
            encrypt_bytes(b"data", "")


@unittest.skipUnless(HAVE_CRYPTO, "cryptography not installed")
class TestRecordingSessionSave(unittest.TestCase):
    def test_save_is_refused_when_recording_is_not_enabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp, recording_enabled=False)
            session = RecordingSession(call_sid="CA-1", ani="+15552345678")
            with self.assertRaises(DisabledError):
                session.save(config)
            # Fail closed means NOTHING was written, not a partial bundle.
            self.assertEqual(os.listdir(tmp), [])

    def test_save_is_refused_with_no_encryption_key_ring_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp, recording_encryption_keys_json="")
            session = RecordingSession(call_sid="CA-1", ani="+15552345678")
            with self.assertRaises(ValueError):
                session.save(config)
            self.assertEqual(os.listdir(tmp), [])

    def test_save_is_refused_when_current_key_id_is_not_in_the_ring(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp, recording_current_key_id="does-not-exist")
            session = RecordingSession(call_sid="CA-1", ani="+15552345678")
            with self.assertRaises(ValueError):
                session.save(config)
            self.assertEqual(os.listdir(tmp), [])

    @unittest.skipUnless(sys.platform == "win32", "icacls is Windows-only")
    def test_real_save_restricts_the_bundle_directory_to_the_current_user(self):
        """Fix round 2 (P1): real `icacls`, no mocks — the bundle_dir
        the save actually wrote into must show no principal beyond the
        current user and the fixed OS-trusted set (SYSTEM,
        Administrators, OWNER RIGHTS, CREATOR OWNER)."""
        import subprocess

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-acl-1", ani="+15552345678")
            session.append_caller_audio(b"\x00\x01" * 100)
            session.save(config)
            lookup_key = ani_lookup_key("+15552345678", config.recording_index_secret)
            bundle_dir = os.path.join(tmp, lookup_key, "CA-acl-1")
            result = subprocess.run(["icacls", bundle_dir], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0)
            username = os.environ.get("USERNAME", "")
            self.assertIn(username.lower(), result.stdout.lower())
            for forbidden in ("everyone", "authenticated users", "builtin\\users"):
                self.assertNotIn(forbidden, result.stdout.lower())

    def test_acl_restriction_tool_failure_fails_the_save_closed(self):
        """Fix round 2 (P1): fix round 1's version swallowed every
        exception from the icacls call with `check=False` and no
        re-raise — a save proceeded even if the ACL tool silently did
        nothing. Now a failing restriction tool must abort save()
        entirely, before any bundle file is written."""
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-acl-2", ani="+15552345678")
            session.append_caller_audio(b"\x00\x01" * 100)
            with mock.patch("app.recording.subprocess.run") as mock_run:
                mock_run.return_value = mock.Mock(returncode=1, stdout="", stderr="simulated icacls failure")
                from app.recording import RecordingAclError
                with self.assertRaises(RecordingAclError):
                    session.save(config)
            # Fail closed means nothing was left behind for this call.
            lookup_key = ani_lookup_key("+15552345678", config.recording_index_secret)
            bundle_dir = os.path.join(tmp, lookup_key, "CA-acl-2")
            if os.path.isdir(bundle_dir):
                self.assertEqual(os.listdir(bundle_dir), [])

    @unittest.skipUnless(sys.platform == "win32", "icacls verification parsing is Windows-specific")
    def test_acl_verification_catches_an_unexpected_principal(self):
        """Fix round 2 (P1): if the restriction commands "succeed" (exit
        0) but the ACL, when queried back, still shows a principal
        outside the always-allowed set (simulating a real leak, e.g. a
        stale "BUILTIN\\Users" grant that /grant:r somehow didn't
        remove), the save must still fail closed."""
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-acl-3", ani="+15552345678")
            session.append_caller_audio(b"\x00\x01" * 100)

            def fake_run(args, **kwargs):
                if args[0] == "icacls" and len(args) == 2:
                    # The verification query (just `icacls <path>`, no
                    # further args) — report a leaked extra principal.
                    path = args[1]
                    username = os.environ.get("USERNAME", "user")
                    return mock.Mock(
                        returncode=0,
                        stdout=f"{path} BUILTIN\\Users:(OI)(CI)(F)\n            {username}:(OI)(CI)(F)\n\n"
                               f"Successfully processed 1 files; Failed processing 0 files\n",
                        stderr="")
                return mock.Mock(returncode=0, stdout="processed file\n", stderr="")

            with mock.patch("app.recording.subprocess.run", side_effect=fake_run):
                from app.recording import RecordingAclError
                with self.assertRaises(RecordingAclError):
                    session.save(config)

    @unittest.skipUnless(sys.platform == "win32", "icacls verification parsing is Windows-specific")
    def test_acl_verification_rejects_an_impostor_principal_that_merely_contains_the_username(self):
        """Fix round 3 (P1 — ChatGPT re-review 2026-11-17): the reviewer
        proved fix round 2's `username.upper() in p` was a SUBSTRING
        match — an ACE for a completely different account whose name
        merely CONTAINS the real username as a substring (e.g.
        `OTHER\\JASON-GUEST` when the real user is `JASON`) was wrongly
        treated as "the current user is present." Here BOTH the real
        current user's ACE and an impostor's ACE are present; the
        impostor alone must make this an unexpected/rejected ACL, even
        though the real user's own ACE is ALSO there."""
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-acl-impostor-1", ani="+15552345678")
            session.append_caller_audio(b"\x00\x01" * 100)

            real_whoami_identity = "CURRENT\\JASON"

            def fake_run(args, **kwargs):
                if args[0] == "whoami":
                    return mock.Mock(returncode=0, stdout='"User Name","SID"\r\n"current\\jason","S-1-5-21-0"\r\n', stderr="")
                if args[0] == "icacls" and len(args) == 2:
                    path = args[1]
                    return mock.Mock(
                        returncode=0,
                        stdout=f"{path} {real_whoami_identity}:(OI)(CI)(F)\n"
                               f"            OTHER\\JASON-GUEST:(OI)(CI)(F)\n\n"
                               f"Successfully processed 1 files; Failed processing 0 files\n",
                        stderr="")
                return mock.Mock(returncode=0, stdout="processed file\n", stderr="")

            with mock.patch("app.recording.subprocess.run", side_effect=fake_run):
                from app.recording import RecordingAclError
                with self.assertRaises(RecordingAclError):
                    session.save(config)

    @unittest.skipUnless(sys.platform == "win32", "icacls verification parsing is Windows-specific")
    def test_acl_verification_rejects_when_only_an_impostor_principal_is_present(self):
        """Fix round 3 (P1): the more severe half of the same bug — the
        REAL current user's ACE is entirely ABSENT, and only an
        impostor whose name contains the username as a substring is
        present. Fix round 2's substring check would have accepted
        this as "user_present=True"; it must now be rejected."""
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-acl-impostor-2", ani="+15552345678")
            session.append_caller_audio(b"\x00\x01" * 100)

            def fake_run(args, **kwargs):
                if args[0] == "whoami":
                    return mock.Mock(returncode=0, stdout='"User Name","SID"\r\n"current\\jason","S-1-5-21-0"\r\n', stderr="")
                if args[0] == "icacls" and len(args) == 2:
                    path = args[1]
                    # ONLY the impostor — the real CURRENT\JASON ACE is missing.
                    return mock.Mock(
                        returncode=0,
                        stdout=f"{path} OTHER\\JASON-GUEST:(OI)(CI)(F)\n\n"
                               f"Successfully processed 1 files; Failed processing 0 files\n",
                        stderr="")
                return mock.Mock(returncode=0, stdout="processed file\n", stderr="")

            with mock.patch("app.recording.subprocess.run", side_effect=fake_run):
                from app.recording import RecordingAclError
                with self.assertRaises(RecordingAclError):
                    session.save(config)

    @unittest.skipUnless(sys.platform == "win32", "icacls verification parsing is Windows-specific")
    def test_acl_verification_rejects_a_different_local_account_sharing_the_same_bare_username(self):
        """Fix round 4 (P1 — ChatGPT re-review 2026-11-17): fix round 3
        correctly stopped substring-matching, but still UNIONED in
        env-var-derived aliases (USERDOMAIN\\USERNAME, COMPUTERNAME\\USERNAME)
        even when `whoami` had already resolved the real identity. On a
        domain-joined machine the real principal might be `CORP\\JASON`
        while a totally different LOCAL account `HOST\\JASON` also
        exists; the old code treated both as "the current user." Here
        whoami resolves `CORP\\JASON`, env vars say USERDOMAIN=CORP /
        COMPUTERNAME=HOST / USERNAME=JASON, and the ACL shows BOTH
        `CORP\\JASON` (real) AND `HOST\\JASON` (a different, unverified
        account) — the second principal alone must make this rejected,
        even though the real user's own ACE is also present."""
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-acl-alias-1", ani="+15552345678")
            session.append_caller_audio(b"\x00\x01" * 100)

            env_patch = {"USERNAME": "JASON", "USERDOMAIN": "CORP", "COMPUTERNAME": "HOST"}

            def fake_run(args, **kwargs):
                if args[0] == "whoami":
                    return mock.Mock(returncode=0, stdout='"User Name","SID"\r\n"corp\\jason","S-1-5-21-0"\r\n', stderr="")
                if args[0] == "icacls" and len(args) == 2:
                    path = args[1]
                    return mock.Mock(
                        returncode=0,
                        stdout=f"{path} CORP\\JASON:(OI)(CI)(F)\n"
                               f"            HOST\\JASON:(OI)(CI)(F)\n\n"
                               f"Successfully processed 1 files; Failed processing 0 files\n",
                        stderr="")
                return mock.Mock(returncode=0, stdout="processed file\n", stderr="")

            with mock.patch.dict(os.environ, env_patch), mock.patch("app.recording.subprocess.run", side_effect=fake_run):
                from app.recording import RecordingAclError
                with self.assertRaises(RecordingAclError):
                    session.save(config)

    @unittest.skipUnless(sys.platform == "win32", "icacls verification parsing is Windows-specific")
    def test_acl_verification_rejects_when_only_a_different_local_account_is_present(self):
        """Fix round 4 (P1): the more severe half — the REAL whoami-
        resolved identity (`CORP\\JASON`) is entirely ABSENT from the
        ACL, and only the different local account (`HOST\\JASON`,
        sharing the bare username but not actually verified as the
        same principal) is present. The old code's unconditional union
        would have let the env-var-derived `HOST\\JASON` alias satisfy
        `user_present` even though the real current user's own ACE
        never appeared."""
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-acl-alias-2", ani="+15552345678")
            session.append_caller_audio(b"\x00\x01" * 100)

            env_patch = {"USERNAME": "JASON", "USERDOMAIN": "CORP", "COMPUTERNAME": "HOST"}

            def fake_run(args, **kwargs):
                if args[0] == "whoami":
                    return mock.Mock(returncode=0, stdout='"User Name","SID"\r\n"corp\\jason","S-1-5-21-0"\r\n', stderr="")
                if args[0] == "icacls" and len(args) == 2:
                    path = args[1]
                    # ONLY HOST\JASON — the real CORP\JASON ACE is missing entirely.
                    return mock.Mock(
                        returncode=0,
                        stdout=f"{path} HOST\\JASON:(OI)(CI)(F)\n\n"
                               f"Successfully processed 1 files; Failed processing 0 files\n",
                        stderr="")
                return mock.Mock(returncode=0, stdout="processed file\n", stderr="")

            with mock.patch.dict(os.environ, env_patch), mock.patch("app.recording.subprocess.run", side_effect=fake_run):
                from app.recording import RecordingAclError
                with self.assertRaises(RecordingAclError):
                    session.save(config)

    @unittest.skipUnless(sys.platform == "win32", "_current_user_identities_win32 is Windows-specific")
    def test_current_user_identities_returns_only_whoami_result_never_unioned_with_env_aliases(self):
        """Fix round 4 (P1), unit-level: directly proves
        `_current_user_identities_win32()` returns ONLY the whoami-
        resolved identity when whoami succeeds — not that identity
        PLUS the env-var-derived aliases."""
        from unittest import mock

        from app.recording import _current_user_identities_win32

        env_patch = {"USERNAME": "JASON", "USERDOMAIN": "CORP", "COMPUTERNAME": "HOST"}

        def fake_run(args, **kwargs):
            return mock.Mock(returncode=0, stdout='"User Name","SID"\r\n"corp\\jason","S-1-5-21-0"\r\n', stderr="")

        with mock.patch.dict(os.environ, env_patch), mock.patch("app.recording.subprocess.run", side_effect=fake_run):
            identities = _current_user_identities_win32()
        self.assertEqual(identities, {"CORP\\JASON"})
        self.assertNotIn("HOST\\JASON", identities)

    def test_real_save_load_decrypt_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-42", ani="+15552345678",
                                        disclosure_revision_id="pinned-2026-11-16",
                                        stt_model_revision="0a363e9161cbc7ed", source="TEST")
            session.append_caller_audio(b"\x00\x01" * 100)
            session.append_agent_audio(b"\x02\x03" * 100)
            session.append_transcript_segment(TranscriptSegment(
                speaker="agent", start_s=0.0, end_s=1.5,
                text="You're speaking with an AI assistant, and this call may be recorded.",
                confidence=1.0))
            session.append_transcript_segment(TranscriptSegment(
                speaker="caller", start_s=1.5, end_s=3.0, text="My sink is leaking.",
                confidence=0.91))
            manifest = session.save(config)

            self.assertEqual(manifest["schemaVersion"], "BrandyReceptionistEvidenceBundleV1")
            self.assertEqual(manifest["callId"], "CA-42")
            self.assertTrue(manifest["maskedDisplayNumber"].endswith("5678"))
            self.assertNotIn("5552345678", manifest["maskedDisplayNumber"])
            lookup_key = manifest["aniLookupKey"]

            loaded = load_manifest(config, lookup_key, "CA-42")
            self.assertEqual(loaded, manifest)

            transcript = decrypt_transcript(config, lookup_key, "CA-42")
            self.assertEqual(len(transcript["segments"]), 2)
            self.assertEqual(transcript["segments"][0]["speaker"], "agent")
            self.assertEqual(transcript["segments"][1]["text"], "My sink is leaking.")

    def test_full_ani_is_never_written_in_plaintext_anywhere_on_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-7", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            session.save(config)
            for root, _dirs, files in os.walk(tmp):
                for name in files:
                    with open(os.path.join(root, name), "rb") as fh:
                        content = fh.read()
                    self.assertNotIn(b"5552345678", content, f"raw ANI leaked into {name}")
                    self.assertNotIn(b"+15552345678", content, f"raw ANI leaked into {name}")

    def test_withheld_ani_is_not_guessed_or_stored(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-withheld", ani=None)
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            manifest = session.save(config)
            self.assertIsNone(manifest["maskedDisplayNumber"])
            self.assertEqual(manifest["aniLookupKey"], "withheld")

    def test_retention_policy_is_recorded_exactly_as_configured_never_invented(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp, recording_retention_days=0)
            session = RecordingSession(call_sid="CA-1", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            manifest = session.save(config)
            self.assertFalse(manifest["retentionPolicySet"])
            self.assertIsNone(manifest["retentionDays"])

            config2 = _config(tmp, recording_retention_days=90)
            session2 = RecordingSession(call_sid="CA-2", ani="+15552345678")
            session2.append_caller_audio(b"\x00" * 10)
            session2.append_agent_audio(b"\x00" * 10)
            manifest2 = session2.save(config2)
            self.assertTrue(manifest2["retentionPolicySet"])
            self.assertEqual(manifest2["retentionDays"], 90)

    def test_audio_file_hashes_match_the_real_written_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-9", ani="+15552345678")
            session.append_caller_audio(b"\x11\x22" * 50)
            session.append_agent_audio(b"\x33\x44" * 50)
            manifest = session.save(config)
            bundle_dir = os.path.join(tmp, manifest["aniLookupKey"], "CA-9")
            with open(os.path.join(bundle_dir, "caller.wav.enc"), "rb") as fh:
                caller_plain = decrypt_bytes(fh.read(), REAL_KEY)
            self.assertEqual(sha256_hex(caller_plain), manifest["audioFileHashes"]["callerWav"])

    def test_manifest_records_the_exact_key_id_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-key", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            manifest = session.save(config)
            self.assertEqual(manifest["encryptionKeyId"], "k1")

    def test_a_bundle_saved_under_an_older_key_still_decrypts_after_rotation(self):
        # Fix round 1, P1: rotating the CURRENT key must not break
        # reading a bundle saved before the rotation.
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)  # ring={k1}, current=k1
            session = RecordingSession(call_sid="CA-old", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            session.append_transcript_segment(TranscriptSegment(speaker="agent", start_s=0, end_s=1, text="Hi."))
            manifest = session.save(config)
            self.assertEqual(manifest["encryptionKeyId"], "k1")

            # Rotate: k2 becomes current, k1 stays in the ring (not yet
            # re-encrypted) — exactly the state right after adding a new
            # key and before running rotate_bundle_key on old bundles.
            rotated_config = _config(
                tmp,
                recording_encryption_keys_json=json.dumps({"k1": REAL_KEY, "k2": REAL_KEY_2}),
                recording_current_key_id="k2",
            )
            transcript = decrypt_transcript(rotated_config, manifest["aniLookupKey"], "CA-old")
            self.assertEqual(transcript["segments"][0]["text"], "Hi.")

            # A NEW save under the rotated config uses k2.
            session2 = RecordingSession(call_sid="CA-new", ani="+15552345678")
            session2.append_caller_audio(b"\x00" * 10)
            session2.append_agent_audio(b"\x00" * 10)
            manifest2 = session2.save(rotated_config)
            self.assertEqual(manifest2["encryptionKeyId"], "k2")

    def test_rotate_bundle_key_re_encrypts_an_existing_bundle_to_the_current_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-rotate", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            session.append_transcript_segment(TranscriptSegment(speaker="agent", start_s=0, end_s=1, text="Original."))
            manifest = session.save(config)
            lookup_key = manifest["aniLookupKey"]
            self.assertEqual(manifest["encryptionKeyId"], "k1")

            rotated_config = _config(
                tmp,
                recording_encryption_keys_json=json.dumps({"k1": REAL_KEY, "k2": REAL_KEY_2}),
                recording_current_key_id="k2",
            )
            updated_manifest = rotate_bundle_key(rotated_config, lookup_key, "CA-rotate")
            self.assertEqual(updated_manifest["encryptionKeyId"], "k2")

            # The file on disk is now actually re-encrypted under k2 —
            # decrypting with k1 alone must fail; k2 alone must succeed.
            bundle_dir = os.path.join(tmp, lookup_key, "CA-rotate")
            with open(os.path.join(bundle_dir, "transcript.json.enc"), "rb") as fh:
                token = fh.read()
            with self.assertRaises(Exception):
                decrypt_bytes(token, REAL_KEY)
            plain = json.loads(decrypt_bytes(token, REAL_KEY_2))
            self.assertEqual(plain["segments"][0]["text"], "Original.")

            # Content is unchanged by rotation — only the key changed.
            transcript = decrypt_transcript(rotated_config, lookup_key, "CA-rotate")
            self.assertEqual(transcript["segments"][0]["text"], "Original.")

    def test_rotate_bundle_key_refuses_an_unknown_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            with self.assertRaises(ValueError):
                rotate_bundle_key(config, "withheld", "CA-does-not-exist")

    def test_decrypt_bytes_any_key_tries_every_key_in_the_ring(self):
        token = encrypt_bytes(b"secret payload", REAL_KEY_2)
        # k1 alone cannot decrypt a k2-encrypted token...
        with self.assertRaises(Exception):
            decrypt_bytes_any_key(token, [REAL_KEY])
        # ...but the full ring (k1 and k2) succeeds.
        self.assertEqual(decrypt_bytes_any_key(token, [REAL_KEY, REAL_KEY_2]), b"secret payload")


@unittest.skipUnless(HAVE_CRYPTO, "cryptography not installed")
class TestDeleteBundle(unittest.TestCase):
    def test_refuses_without_explicit_confirm(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-del-1", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            manifest = session.save(config)
            with self.assertRaises(ValueError):
                delete_bundle(config, manifest["aniLookupKey"], "CA-del-1", confirm=False)
            # Still there — refusal did not delete anything.
            self.assertIsNotNone(load_manifest(config, manifest["aniLookupKey"], "CA-del-1"))

    def test_real_delete_removes_every_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-del-2", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            manifest = session.save(config)
            ok = delete_bundle(config, manifest["aniLookupKey"], "CA-del-2", confirm=True)
            self.assertTrue(ok)
            self.assertIsNone(load_manifest(config, manifest["aniLookupKey"], "CA-del-2"))

    def test_legal_hold_refuses_deletion_even_with_confirm(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            session = RecordingSession(call_sid="CA-del-3", ani="+15552345678")
            session.append_caller_audio(b"\x00" * 10)
            session.append_agent_audio(b"\x00" * 10)
            manifest = session.save(config)
            bundle_dir = os.path.join(tmp, manifest["aniLookupKey"], "CA-del-3")
            manifest["legalHold"] = True
            with open(os.path.join(bundle_dir, "manifest.json"), "w", encoding="utf-8") as fh:
                json.dump(manifest, fh)
            with self.assertRaises(ValueError):
                delete_bundle(config, manifest["aniLookupKey"], "CA-del-3", confirm=True)

    def test_deleting_a_nonexistent_bundle_returns_false_not_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(tmp)
            self.assertFalse(delete_bundle(config, "withheld", "CA-does-not-exist", confirm=True))


if __name__ == "__main__":
    unittest.main()
