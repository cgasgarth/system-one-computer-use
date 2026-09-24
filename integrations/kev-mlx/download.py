"""Resolve a Kev checkpoint and its pinned base without loading GPU weights."""
import argparse
from kev.checkpoint import Checkpoint, resolve_run

parser = argparse.ArgumentParser()
parser.add_argument("--run", required=True)
args = parser.parse_args()
checkpoint = Checkpoint(args.run)
resolve_run(f"{checkpoint.meta.base}@{checkpoint.meta.base_revision or ''}")
