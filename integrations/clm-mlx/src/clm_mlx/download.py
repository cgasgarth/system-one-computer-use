"""Download exact model assets without allocating GPU weights."""

import argparse
import os
import re
from pathlib import Path

from huggingface_hub import get_cached_repo_tree, hf_hub_download, snapshot_download
from huggingface_hub.errors import CachedRepoTreeNotFoundError, LocalEntryNotFoundError


REVISION_PATTERN = re.compile(r"[0-9a-f]{40}\Z")


def exact_revision(parser: argparse.ArgumentParser, value: str | None, name: str) -> str:
    if value is None or REVISION_PATTERN.fullmatch(value) is None:
        parser.error(f"{name} must be an exact 40-character Hugging Face commit SHA")
    return value


def cached_snapshot(repository: str, revision: str, **kwargs) -> str:
    try:
        # A cached tree lets the SDK detect a missing weight in a partial snapshot.
        get_cached_repo_tree(repository, revision=revision)
        return snapshot_download(repository, revision=revision, local_files_only=True, **kwargs)
    except (CachedRepoTreeNotFoundError, LocalEntryNotFoundError):
        return snapshot_download(repository, revision=revision, **kwargs)


def cached_file(repository: str, name: str, revision: str) -> str:
    try:
        return hf_hub_download(repository, name, revision=revision, local_files_only=True)
    except LocalEntryNotFoundError:
        return hf_hub_download(repository, name, revision=revision)


def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--text-model")
    parser.add_argument("--text-revision")
    parser.add_argument("--text-output")
    parser.add_argument("--encoder-revision")
    parser.add_argument("--head-revision")
    args = parser.parse_args(argv)
    if args.text_model:
        if args.encoder_revision or args.head_revision or not args.text_output:
            parser.error("Text download requires --text-output and no CLM revisions")
        revision = exact_revision(parser, args.text_revision, "--text-revision")
        snapshot = Path(cached_snapshot(args.text_model, revision))
        output = Path(args.text_output)
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.is_symlink() and output.resolve() == snapshot.resolve():
            return
        temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
        temporary.unlink(missing_ok=True)
        try:
            temporary.symlink_to(snapshot, target_is_directory=True)
            os.replace(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
        return
    if args.text_output or args.text_revision:
        parser.error("CLM download does not accept text-model arguments")
    encoder = exact_revision(parser, args.encoder_revision, "--encoder-revision")
    head = exact_revision(parser, args.head_revision, "--head-revision")
    cached_snapshot(
        "Qwen/Qwen3-8B", encoder,
        allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model"], max_workers=4,
    )
    cached_file(
        "Contrastive-LM/CLM-v0.1-8B", "CLM_v0.1-8B.pt", head
    )


if __name__ == "__main__":
    main()
