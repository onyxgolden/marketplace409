#!/usr/bin/env python3
"""Build the deterministic OpenVoice V2 checkpoints zip.

The upstream S3-hosted ``checkpoints_v2_0417.zip`` is gone (the bucket
``myshell-public-repo-host`` was deleted -- ``NoSuchBucket``, verified
2026-11-12 from the dev VM and the iBUYPOWER). The setup script now
downloads the same files from the official Hugging Face repos
(``myshell-ai/OpenVoice``, pinned revision -- see ``HF_REVISION`` in
``tools/narration/setup-env.ps1`` -- for the nine ``checkpoints/``
files, and ``myshell-ai/OpenVoiceV2``, pinned revision -- see
``HF_SES_REVISION`` -- for the six English ``base_speakers/ses/``
embeddings the V2 generation path loads) and assembles this zip
locally.

The zip bytes MUST be reproducible: its SHA-256 is recorded in the
setup receipt (``checkpoints_v2_zip_sha256``) and pinned in the Rust
core (``CHECKPOINTS_ZIP_SHA256``) and the runner
(``WEIGHTS_SHA256_PINNED``). Every input to the zip format is
therefore fixed here: sorted arcname order, fixed 1980-01-01
timestamps, fixed Unix permissions, ZIP_DEFLATED level 6, no
directory entries, no extra fields. The same script run on Linux or
Windows, against the same fifteen files, produces byte-identical output.

Expected stage layout (the HF repos' trees)::

    <stage>/checkpoints/base_speakers/EN/checkpoint.pth
    <stage>/checkpoints/base_speakers/EN/config.json
    <stage>/checkpoints/base_speakers/EN/en_default_se.pth
    <stage>/checkpoints/base_speakers/EN/en_style_se.pth
    <stage>/checkpoints/base_speakers/ZH/checkpoint.pth
    <stage>/checkpoints/base_speakers/ZH/config.json
    <stage>/checkpoints/base_speakers/ZH/zh_default_se.pth
    <stage>/checkpoints/base_speakers/ses/en-au.pth
    <stage>/checkpoints/base_speakers/ses/en-br.pth
    <stage>/checkpoints/base_speakers/ses/en-default.pth
    <stage>/checkpoints/base_speakers/ses/en-india.pth
    <stage>/checkpoints/base_speakers/ses/en-newest.pth
    <stage>/checkpoints/base_speakers/ses/en-us.pth
    <stage>/checkpoints/converter/checkpoint.pth
    <stage>/checkpoints/converter/config.json

Zip layout (mirrors the original upstream zip)::

    checkpoints_v2/base_speakers/EN/checkpoint.pth
    checkpoints_v2/base_speakers/EN/config.json
    checkpoints_v2/base_speakers/EN/en_default_se.pth
    checkpoints_v2/base_speakers/EN/en_style_se.pth
    checkpoints_v2/base_speakers/ZH/checkpoint.pth
    checkpoints_v2/base_speakers/ZH/config.json
    checkpoints_v2/base_speakers/ZH/zh_default_se.pth
    checkpoints_v2/base_speakers/ses/en-au.pth
    checkpoints_v2/base_speakers/ses/en-br.pth
    checkpoints_v2/base_speakers/ses/en-default.pth
    checkpoints_v2/base_speakers/ses/en-india.pth
    checkpoints_v2/base_speakers/ses/en-newest.pth
    checkpoints_v2/base_speakers/ses/en-us.pth
    checkpoints_v2/converter/checkpoint.pth
    checkpoints_v2/converter/config.json

Usage::

    python build_checkpoints_zip.py --stage <dir> --out checkpoints_v2_0417.zip

Prints the SHA-256 of the zip written. Exits non-zero (and writes no
zip) when the stage does not contain exactly the fifteen expected files.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import zipfile
from pathlib import Path

# The fifteen files of the upstream checkpoints_v2 distribution:
# the nine files of myshell-ai/OpenVoice's checkpoints/ tree plus the
# six English base-speaker embeddings of myshell-ai/OpenVoiceV2's
# base_speakers/ses/ tree (the V2 generation path loads one per
# MeloTTS EN speaker key; see normalize_speaker_key in
# narration_runner.py). Relative to the stage's checkpoints/ tree.
# Sorted: this is the zip order.
EXPECTED_FILES = (
    "base_speakers/EN/checkpoint.pth",
    "base_speakers/EN/config.json",
    "base_speakers/EN/en_default_se.pth",
    "base_speakers/EN/en_style_se.pth",
    "base_speakers/ZH/checkpoint.pth",
    "base_speakers/ZH/config.json",
    "base_speakers/ZH/zh_default_se.pth",
    "base_speakers/ses/en-au.pth",
    "base_speakers/ses/en-br.pth",
    "base_speakers/ses/en-default.pth",
    "base_speakers/ses/en-india.pth",
    "base_speakers/ses/en-newest.pth",
    "base_speakers/ses/en-us.pth",
    "converter/checkpoint.pth",
    "converter/config.json",
)

ZIP_TOP_DIR = "checkpoints_v2"
# Minimum ZIP timestamp; fixed so the bytes are reproducible.
FIXED_DATE_TIME = (1980, 1, 1, 0, 0, 0)
# Unix file mode recorded for every entry (regular file, 0644).
FIXED_EXTERNAL_ATTR = 0o644 << 16


def build_zip(stage_dir: Path, out_path: Path) -> str:
    """Build the deterministic zip; return its lowercase hex SHA-256."""
    checkpoints_dir = stage_dir / "checkpoints"
    present = sorted(
        str(p.relative_to(checkpoints_dir)).replace("\\", "/")
        for p in checkpoints_dir.rglob("*")
        if p.is_file()
    )
    missing = [f for f in EXPECTED_FILES if f not in present]
    extra = [f for f in present if f not in EXPECTED_FILES]
    if missing:
        raise ValueError(f"stage is missing checkpoints files: {missing}")
    if extra:
        raise ValueError(f"stage has unexpected files (refusing to "
                         f"change the pinned zip): {extra}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in EXPECTED_FILES:
            src = checkpoints_dir / rel
            arcname = f"{ZIP_TOP_DIR}/{rel}"
            info = zipfile.ZipInfo(arcname, date_time=FIXED_DATE_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3  # Unix; explicit so Windows builds match
            info.external_attr = FIXED_EXTERNAL_ATTR
            info.internal_attr = 0
            info.extra = b""
            with open(src, "rb") as f:
                # compresslevel lives on writestr, not ZipInfo.
                zf.writestr(info, f.read(),
                            compress_type=zipfile.ZIP_DEFLATED,
                            compresslevel=6)
    tmp_path.replace(out_path)
    return hashlib.sha256(out_path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True,
                        help="dir containing the checkpoints/ tree")
    parser.add_argument("--out", required=True,
                        help="zip path to write")
    args = parser.parse_args(argv)
    try:
        digest = build_zip(Path(args.stage), Path(args.out))
    except (ValueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
