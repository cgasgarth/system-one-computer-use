"""Pinned snapshot integrity checks without downloading model weights."""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from huggingface_hub.errors import CachedRepoTreeNotFoundError, LocalEntryNotFoundError
from julia_runtime import checkpoint

REVISION = "a" * 40
DOWNLOAD_FILE = Path(__file__).resolve().parents[1] / "download.py"
DOWNLOAD_SPEC = importlib.util.spec_from_file_location("julia_download", DOWNLOAD_FILE)
download = importlib.util.module_from_spec(DOWNLOAD_SPEC)
DOWNLOAD_SPEC.loader.exec_module(download)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tree = patch.object(checkpoint, "get_cached_repo_tree")
        self.tree.start()
        self.addCleanup(self.tree.stop)

    def test_accepts_only_matching_policy_and_real_weight_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            (snapshot / "julia").mkdir()
            (snapshot / "julia" / "__init__.py").write_text("")
            content = b"safetensors fixture"
            (snapshot / "model.safetensors").write_bytes(content)
            digest = hashlib.sha256(content).hexdigest()
            (snapshot / "inference-policy.json").write_text(
                json.dumps({"weights_sha256": digest})
            )
            with patch.object(checkpoint, "snapshot_download", return_value=directory) as download:
                self.assertEqual(checkpoint.resolved_snapshot(REVISION, offline=True), snapshot)
                download.assert_called_once_with(
                    checkpoint.REPOSITORY, revision=REVISION, local_files_only=True
                )
                (snapshot / "model.safetensors").write_text("LFS pointer")
                with self.assertRaisesRegex(ValueError, "SHA-256"):
                    checkpoint.resolved_snapshot(REVISION, offline=True)

    def test_rejects_unexpected_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot = Path(directory)
            (snapshot / "inference-policy.json").write_text(
                json.dumps({"weights_sha256": "wrong"})
            )
            with patch.object(checkpoint, "snapshot_download", return_value=directory):
                with self.assertRaisesRegex(ValueError, "weight policy"):
                    checkpoint.resolved_snapshot(REVISION)

    def test_refuses_a_mutable_revision_before_download(self):
        with patch.object(checkpoint, "snapshot_download") as download:
            with self.assertRaisesRegex(ValueError, "exact 40-character"):
                checkpoint.resolved_snapshot("main")
            download.assert_not_called()

    def test_download_uses_cached_revision_and_fetches_only_when_missing(self):
        with patch.object(download, "resolved_snapshot") as snapshot:
            download.main(["--revision", REVISION])
            snapshot.assert_called_once_with(REVISION, offline=True)
        with patch.object(
            download, "resolved_snapshot",
            side_effect=[LocalEntryNotFoundError("missing"), Path("/tmp/snapshot")],
        ) as snapshot:
            download.main(["--revision", REVISION])
            self.assertEqual(snapshot.call_count, 2)
            snapshot.assert_any_call(REVISION, offline=True)
            snapshot.assert_any_call(REVISION)
        with patch.object(
            download, "resolved_snapshot",
            side_effect=[CachedRepoTreeNotFoundError("no tree"), Path("/tmp/snapshot")],
        ) as snapshot:
            download.main(["--revision", REVISION])
            snapshot.assert_any_call(REVISION)


if __name__ == "__main__":
    unittest.main()
