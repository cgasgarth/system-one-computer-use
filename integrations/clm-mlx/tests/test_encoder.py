"""Small encoder-contract tests without loading checkpoint weights."""

from collections import OrderedDict
import threading
import unittest

import mlx.core as mx
import numpy as np

from clm_mlx.encoder import MLXEmbedder


class FakeTokenizer:
    pad_token_id = None
    eos_token_id = 99

    def encode(self, text: str, add_special_tokens: bool = False) -> list[int]:
        assert not add_special_tokens
        if text == "long":
            return [1, 2, 3, 4]
        if text == "short":
            return [5, 6]
        if text == " ":
            return [7]
        if text == "edge":
            return [8] * 2048
        return [8] * 2049


class FakeEncoder:
    def __call__(self, inputs: mx.array) -> mx.array:
        values = inputs.astype(mx.float32)
        return mx.stack([values, mx.ones_like(values)], axis=-1)


def embedder() -> MLXEmbedder:
    instance = MLXEmbedder.__new__(MLXEmbedder)
    instance.tok = FakeTokenizer()
    instance.encoder = FakeEncoder()
    instance.cache = OrderedDict()
    instance.cache_limit = 4
    instance._lock = threading.RLock()
    return instance


class EncoderContractTest(unittest.TestCase):
    def test_mixed_lengths_pool_last_real_token_and_preserve_order(self) -> None:
        model = embedder()
        mixed, tokens = model.embed(["short", "long", "short"])
        np.testing.assert_allclose(mixed[0], [6 / np.sqrt(37), 1 / np.sqrt(37)])
        np.testing.assert_allclose(mixed[1], [4 / np.sqrt(17), 1 / np.sqrt(17)])
        np.testing.assert_array_equal(mixed[0], mixed[2])
        self.assertEqual(tokens, 6)
        model.cache.clear()
        short, _ = model.embed(["short"])
        np.testing.assert_array_equal(short[0], mixed[0])

    def test_empty_maps_to_space_and_oversized_input_raises(self) -> None:
        model = embedder()
        empty, _ = model.embed([""])
        model.cache.clear()
        space, _ = model.embed([" "])
        np.testing.assert_array_equal(empty, space)
        edge, tokens = model.embed(["edge"])
        self.assertEqual(edge.shape, (1, 2))
        self.assertEqual(tokens, 2048)
        with self.assertRaisesRegex(ValueError, "2048"):
            model.embed(["overlong"])


if __name__ == "__main__":
    unittest.main()
