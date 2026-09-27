"""Resolve and verify one exact Julia source and weight snapshot."""

import hashlib
import json
import re
from pathlib import Path

from huggingface_hub import get_cached_repo_tree, snapshot_download

REPOSITORY = "SupersonicLabs/Julia-1"
READ_BYTES = 8 * 1024 * 1024
REVISION_PATTERN = re.compile(r"[0-9a-f]{40}\Z")
WEIGHT_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


def resolved_snapshot(revision: str, *, offline: bool = False) -> Path:
    if REVISION_PATTERN.fullmatch(revision) is None:
        raise ValueError("Julia requires an exact 40-character checkpoint revision.")
    if offline:
        # A snapshot path alone does not prove completeness without its cached tree.
        get_cached_repo_tree(REPOSITORY, revision=revision)
    snapshot = Path(snapshot_download(REPOSITORY, revision=revision, local_files_only=offline))
    policy = json.loads((snapshot / "inference-policy.json").read_text())
    expected = policy.get("weights_sha256")
    if not isinstance(expected, str) or WEIGHT_PATTERN.fullmatch(expected) is None:
        raise ValueError("The Julia snapshot has no valid weight policy.")
    digest = hashlib.sha256()
    with (snapshot / "model.safetensors").open("rb") as weights:
        while chunk := weights.read(READ_BYTES):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError("The Julia weights failed SHA-256 verification.")
    if not (snapshot / "julia" / "__init__.py").is_file():
        raise ValueError("The Julia source package is missing.")
    return snapshot
