"""Exact revision and atomic text-model pointer tests without model downloads."""

import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from huggingface_hub.errors import CachedRepoTreeNotFoundError, LocalEntryNotFoundError
from clm_mlx import download

ENCODER = "a" * 40
HEAD = "b" * 40
TEXT = "c" * 40


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.tree = patch.object(download, "get_cached_repo_tree")
        self.tree.start()
        self.addCleanup(self.tree.stop)

    def test_clm_download_uses_both_selected_revisions(self):
        with patch.object(download, "snapshot_download") as encoder, \
             patch.object(download, "hf_hub_download") as head:
            download.main(["--encoder-revision", ENCODER, "--head-revision", HEAD])
            encoder.assert_called_once_with(
                "Qwen/Qwen3-8B", revision=ENCODER, local_files_only=True,
                allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model"], max_workers=4,
            )
            head.assert_called_once_with(
                "Contrastive-LM/CLM-v0.1-8B", "CLM_v0.1-8B.pt", revision=HEAD,
                local_files_only=True,
            )

    def test_text_pointer_replaces_an_existing_selection_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "old"
            new = root / "new"
            old.mkdir()
            new.mkdir()
            output = root / "selected"
            output.symlink_to(old, target_is_directory=True)
            with patch.object(download, "snapshot_download", return_value=new) as snapshot:
                download.main(["--text-model", "example/text", "--text-revision", TEXT,
                               "--text-output", str(output)])
            snapshot.assert_called_once_with("example/text", revision=TEXT, local_files_only=True)
            self.assertEqual(output.resolve(), new.resolve())

    def test_missing_cached_snapshot_downloads_the_exact_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(
                download, "snapshot_download",
                side_effect=[LocalEntryNotFoundError("not cached"), directory],
            ) as snapshot:
                result = download.cached_snapshot("example/model", ENCODER)
            self.assertEqual(result, directory)
            self.assertEqual(snapshot.call_count, 2)
            snapshot.assert_any_call("example/model", revision=ENCODER, local_files_only=True)
            snapshot.assert_any_call("example/model", revision=ENCODER)

    def test_mutable_revision_fails_before_any_download(self):
        with patch.object(download, "snapshot_download") as snapshot:
            with redirect_stderr(StringIO()), self.assertRaises(SystemExit):
                download.main(["--encoder-revision", "main", "--head-revision", HEAD])
            snapshot.assert_not_called()

    def test_snapshot_without_cached_tree_fetches_exact_revision(self):
        with patch.object(download, "get_cached_repo_tree",
                          side_effect=CachedRepoTreeNotFoundError("missing")), \
             patch.object(download, "snapshot_download", return_value="/cache/repaired") as snapshot:
            self.assertEqual(download.cached_snapshot("example/model", ENCODER), "/cache/repaired")
            snapshot.assert_called_once_with("example/model", revision=ENCODER)


if __name__ == "__main__":
    unittest.main()
