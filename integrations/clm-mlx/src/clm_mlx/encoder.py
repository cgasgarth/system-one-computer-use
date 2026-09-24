"""Qwen3 last-token pooling with a bounded cache of normalized embeddings."""

from collections import OrderedDict
from pathlib import Path
import threading

import mlx.core as mx
import mlx.nn as nn
import numpy as np
from mlx_lm.utils import load_model
from transformers import AutoTokenizer


class MLXEmbedder:
    def __init__(self, model_path: str, bits: int = 4):
        mx.set_cache_limit(1024**3)
        mx.set_memory_limit(
            min(28 * 1024**3, mx.device_info()["max_recommended_working_set_size"])
        )
        self.tok = AutoTokenizer.from_pretrained(model_path)
        model, _ = load_model(Path(model_path))
        self.encoder = model.model
        del model
        if bits:
            nn.quantize(self.encoder, group_size=64, bits=bits)
        mx.eval(self.encoder.parameters())
        mx.clear_cache()
        self.cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self.cache_limit = 4096
        self._lock = threading.RLock()

    def healthy(self) -> bool:
        return True

    def embed(self, texts: list[str]) -> tuple[np.ndarray, int]:
        with self._lock:
            return self._embed(texts)

    def _embed(self, texts: list[str]) -> tuple[np.ndarray, int]:
        missing = [text for text in dict.fromkeys(texts) if text not in self.cache]
        ids = {
            text: self.tok.encode(text or " ", add_special_tokens=False)
            for text in missing
        }
        if any(len(value) > 2048 for value in ids.values()):
            raise ValueError("CLM encoder input exceeds 2048 tokens")
        missing.sort(key=lambda text: len(ids[text]))
        tokens = sum(len(value) for value in ids.values())
        start = 0
        while start < len(missing):
            end = start + 1
            while (
                end < len(missing)
                and end - start < 16
                and len(ids[missing[end]]) * (end - start + 1) <= 2048
            ):
                end += 1
            batch = missing[start:end]
            lengths = [len(ids[text]) for text in batch]
            width = max(lengths)
            pad = self.tok.pad_token_id or self.tok.eos_token_id
            inputs = mx.array(
                [ids[text] + [pad] * (width - len(ids[text])) for text in batch],
                dtype=mx.int32,
            )
            hidden = self.encoder(inputs)
            pooled = hidden[mx.arange(len(batch)), mx.array(lengths) - 1].astype(
                mx.float32
            )
            pooled = pooled / mx.maximum(
                mx.linalg.norm(pooled, axis=-1, keepdims=True), 1e-12
            )
            vectors = np.asarray(pooled).copy()
            for text, vector in zip(batch, vectors):
                self.cache[text] = vector
            start = end
        result = np.stack([self.cache[text] for text in texts])
        for text in texts:
            self.cache.move_to_end(text)
        while len(self.cache) > self.cache_limit:
            self.cache.popitem(last=False)
        return result, tokens
