"""Keep the upstream CLM heads, cache, schema, and HTTP routes; use MLX for pooling."""

import argparse
import os

import torch
import uvicorn
from clm.engine import Engine
from clm.server import create_app
from huggingface_hub import hf_hub_download, snapshot_download

from .encoder import MLXEmbedder

ENCODER_REVISION = "b968826d9c46dd6066d109eabc6255188de91218"
HEAD_REVISION = "87655cb835bd76fd66c2da78e1e3709f7fa11a94"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8700)
    parser.add_argument(
        "--bits",
        type=int,
        choices=(0, 4, 8),
        default=4,
        help="0 keeps BF16; 4 is the default quantized encoder",
    )
    args = parser.parse_args()
    torch.set_num_threads(1)
    encoder_path = snapshot_download(
        "Qwen/Qwen3-8B",
        revision=ENCODER_REVISION,
        allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model"],
        max_workers=4,
    )
    head_path = hf_hub_download(
        "Contrastive-LM/CLM-v0.1-8B", "CLM_v0.1-8B.pt", revision=HEAD_REVISION
    )
    engine = Engine(
        embedder=MLXEmbedder(encoder_path, args.bits),
        checkpoint=head_path,
        device="cpu",
        action_cache="64MiB",
    )
    app = create_app(engine, api_key=os.environ.get("CLM_API_KEY"), ui=False)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
