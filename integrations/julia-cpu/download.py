"""Download and verify the selected public Julia source and weights."""

import argparse

from huggingface_hub.errors import CachedRepoTreeNotFoundError, LocalEntryNotFoundError
from julia_runtime.checkpoint import resolved_snapshot

def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    args = parser.parse_args(argv)
    try:
        resolved_snapshot(args.revision, offline=True)
    except (CachedRepoTreeNotFoundError, LocalEntryNotFoundError):
        resolved_snapshot(args.revision)


if __name__ == "__main__":
    main()
