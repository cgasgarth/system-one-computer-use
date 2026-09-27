"""Exact Kev base-pairing metadata tests without loading model weights."""

import importlib.util
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from huggingface_hub import get_cached_repo_tree, snapshot_download
from huggingface_hub.errors import CachedRepoTreeNotFoundError, LocalEntryNotFoundError

MODULE = Path(__file__).resolve().parents[1] / "download.py"
SPEC = importlib.util.spec_from_file_location("kev_download", MODULE)
download = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(download)

CHECKPOINT = "a" * 40
BASE = "b" * 40


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.tree = patch.object(download, "get_cached_repo_tree")
        self.tree.start()
        self.addCleanup(self.tree.stop)

    def test_base_output_uses_only_checkpoint_declared_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "base.json"
            meta = SimpleNamespace(base="Qwen/Qwen3.5-4B-Base", base_revision=BASE)
            with patch.object(download, "Checkpoint", return_value=SimpleNamespace(meta=meta)) as checkpoint, \
                 patch.object(download, "cached_or_download", side_effect=["/cache/kev", "/cache/base"]) as resolve:
                download.main(["--run", f"jaredpalmer/kev-4b@{CHECKPOINT}",
                               "--base-output", str(output)])
            checkpoint.assert_called_once_with("/cache/kev")
            self.assertEqual(resolve.call_args_list[0].args, (f"jaredpalmer/kev-4b@{CHECKPOINT}",))
            self.assertEqual(resolve.call_args_list[1].args, (f"Qwen/Qwen3.5-4B-Base@{BASE}",))
            self.assertEqual(json.loads(output.read_text()), {
                "repository": "Qwen/Qwen3.5-4B-Base", "revision": BASE,
            })
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_missing_declared_base_revision_never_falls_back_to_main(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "base.json"
            meta = SimpleNamespace(base="Qwen/Qwen3.5-4B-Base", base_revision=None)
            with patch.object(download, "Checkpoint", return_value=SimpleNamespace(meta=meta)), \
                 patch.object(download, "cached_or_download", return_value="/cache/kev") as resolve:
                with self.assertRaisesRegex(ValueError, "exact base-model revision"):
                    download.main(["--run", f"jaredpalmer/kev-4b@{CHECKPOINT}",
                                   "--base-output", str(output)])
            resolve.assert_called_once_with(f"jaredpalmer/kev-4b@{CHECKPOINT}")
            self.assertFalse(output.exists())

    def test_mutable_checkpoint_revision_fails_before_resolution(self):
        with patch.object(download, "cached_or_download") as resolve:
            with redirect_stderr(StringIO()), self.assertRaises(SystemExit):
                download.main(["--run", "jaredpalmer/kev-4b@main",
                               "--base-output", "/tmp/unused-base.json"])
            resolve.assert_not_called()

    def test_cached_revision_avoids_network_and_missing_cache_fetches_exact_sha(self):
        run = f"jaredpalmer/kev-4b@{CHECKPOINT}"
        with patch.object(download, "snapshot_download", return_value="/cache/kev") as snapshot, \
             patch.object(download, "resolve_run") as resolve:
            self.assertEqual(download.cached_or_download(run), "/cache/kev")
            snapshot.assert_called_once_with(
                "jaredpalmer/kev-4b", revision=CHECKPOINT,
                allow_patterns=download.FILES, local_files_only=True,
            )
            resolve.assert_not_called()
        with patch.object(download, "snapshot_download",
                          side_effect=LocalEntryNotFoundError("missing")), \
             patch.object(download, "resolve_run", return_value="/cache/new") as resolve:
            self.assertEqual(download.cached_or_download(run), "/cache/new")
            resolve.assert_called_once_with(run)

    def test_missing_tree_does_not_accept_a_partial_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            sha = "a" * 40
            partial = Path(directory) / "models--example--partial" / "snapshots" / sha
            partial.mkdir(parents=True)
            (partial / "config.json").write_text("{}")
            returned = snapshot_download(
                "example/partial", revision=sha, cache_dir=directory, local_files_only=True
            )
            self.assertEqual(Path(returned).resolve(), partial.resolve())
            with self.assertRaises(CachedRepoTreeNotFoundError):
                get_cached_repo_tree("example/partial", revision=sha, cache_dir=directory)
            with patch.object(download, "get_cached_repo_tree",
                              side_effect=CachedRepoTreeNotFoundError("missing")), \
                 patch.object(download, "resolve_run", return_value="/cache/repaired") as resolve:
                self.assertEqual(download.cached_or_download(f"example/partial@{sha}"), "/cache/repaired")
                resolve.assert_called_once()


if __name__ == "__main__":
    unittest.main()
