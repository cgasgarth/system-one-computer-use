"""Resolve an exact Kev checkpoint and its checkpoint-declared base."""

import argparse
import json
import os
import re
from pathlib import Path

from huggingface_hub import get_cached_repo_tree, snapshot_download
from huggingface_hub.errors import CachedRepoTreeNotFoundError, LocalEntryNotFoundError
from kev.checkpoint import Checkpoint, resolve_run

SHA = re.compile(r"[0-9a-f]{40}\Z")
CHECKPOINT = re.compile(r"[^@\s]+/[^@\s]+@[0-9a-f]{40}\Z")
FILES = ["*.json", "*.safetensors", "*.pt", "*.txt", "*.jinja"]


def cached_or_download(run: str) -> str:
    repository, _, revision = run.partition("@")
    try:
        # Without a cached tree, snapshot_download can return a partial directory.
        get_cached_repo_tree(repository, revision=revision)
        return snapshot_download(
            repository, revision=revision, allow_patterns=FILES, local_files_only=True
        )
    except (CachedRepoTreeNotFoundError, LocalEntryNotFoundError):
        return resolve_run(run)


def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    parser.add_argument("--base-output", type=Path, required=True)
    args = parser.parse_args(argv)
    if CHECKPOINT.fullmatch(args.run) is None:
        parser.error("--run must name a repository at an exact 40-character commit SHA")
    checkpoint = Checkpoint(cached_or_download(args.run))
    base = checkpoint.meta.base
    revision = checkpoint.meta.base_revision
    if SHA.fullmatch(revision or "") is None:
        raise ValueError("The Kev checkpoint does not declare an exact base-model revision.")
    cached_or_download(f"{base}@{revision}")
    args.base_output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.base_output.with_name(f"{args.base_output.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps({"repository": base, "revision": revision}))
        os.chmod(temporary, 0o600)
        os.replace(temporary, args.base_output)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
