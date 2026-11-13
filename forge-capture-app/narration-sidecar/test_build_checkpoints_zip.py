"""Tests for the deterministic checkpoints zip builder.

Uses tiny fixture files (same nine relative paths as the real
checkpoints tree) -- no network, no 400 MB downloads. The real zip's
hash is pinned in the Rust core and the runner; these tests prove the
builder properties that make that pin meaningful: byte-identical
output across runs, the exact nine-entry layout, and fail-closed
behavior on a missing or extra file.
"""

import hashlib

import build_checkpoints_zip as bcz


def _stage(tmp_path, contents=None):
    stage = tmp_path / "stage"
    for rel in bcz.EXPECTED_FILES:
        p = stage / "checkpoints" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes((contents or {}).get(rel, f"fixture:{rel}".encode()))
    return stage


def test_build_is_deterministic(tmp_path):
    stage = _stage(tmp_path)
    out_a = tmp_path / "a.zip"
    out_b = tmp_path / "b.zip"
    digest_a = bcz.build_zip(stage, out_a)
    digest_b = bcz.build_zip(stage, out_b)
    assert digest_a == digest_b
    assert digest_a == hashlib.sha256(out_a.read_bytes()).hexdigest()
    assert out_a.read_bytes() == out_b.read_bytes()


def test_build_layout_and_metadata(tmp_path):
    import zipfile

    stage = _stage(tmp_path)
    out = tmp_path / "out.zip"
    bcz.build_zip(stage, out)
    with zipfile.ZipFile(out) as zf:
        names = zf.namelist()
    assert names == sorted(f"checkpoints_v2/{rel}"
                           for rel in bcz.EXPECTED_FILES)
    with zipfile.ZipFile(out) as zf:
        for info in zf.infolist():
            assert info.date_time == (1980, 1, 1, 0, 0, 0)
            assert info.create_system == 3
            assert info.external_attr == (0o644 << 16)
            assert info.compress_type == zipfile.ZIP_DEFLATED
        assert zf.testzip() is None


def test_build_refuses_missing_file(tmp_path):
    stage = _stage(tmp_path)
    (stage / "checkpoints" / "converter" / "config.json").unlink()
    try:
        bcz.build_zip(stage, tmp_path / "out.zip")
    except ValueError as exc:
        assert "missing" in str(exc)
    else:
        raise AssertionError("expected ValueError for missing file")


def test_build_refuses_extra_file(tmp_path):
    stage = _stage(tmp_path)
    (stage / "checkpoints" / "stowaway.txt").write_text("not pinned")
    try:
        bcz.build_zip(stage, tmp_path / "out.zip")
    except ValueError as exc:
        assert "unexpected" in str(exc)
    else:
        raise AssertionError("expected ValueError for extra file")


def test_build_content_change_changes_digest(tmp_path):
    stage = _stage(tmp_path)
    digest_a = bcz.build_zip(stage, tmp_path / "a.zip")
    (stage / "checkpoints" / "converter" / "config.json").write_bytes(b"{}")
    digest_b = bcz.build_zip(stage, tmp_path / "b.zip")
    assert digest_a != digest_b
