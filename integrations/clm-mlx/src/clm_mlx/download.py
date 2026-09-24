"""Download model assets without allocating GPU weights."""
import argparse
from pathlib import Path
from huggingface_hub import hf_hub_download, snapshot_download

ENCODER_REVISION = "b968826d9c46dd6066d109eabc6255188de91218"
HEAD_REVISION = "87655cb835bd76fd66c2da78e1e3709f7fa11a94"
TEXT_REVISION = "674aaa7240b91e8012fcad5d791b7dfe5ba90207"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text-model")
    parser.add_argument("--text-output")
    args = parser.parse_args()
    if args.text_model:
        if not args.text_output:
            parser.error("--text-output is required for a text model")
        snapshot = Path(snapshot_download(args.text_model, revision=TEXT_REVISION))
        output = Path(args.text_output)
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.is_symlink():
            if output.resolve() == snapshot.resolve():
                return
            output.unlink()
        output.symlink_to(snapshot, target_is_directory=True)
        return
    snapshot_download(
        "Qwen/Qwen3-8B", revision=ENCODER_REVISION,
        allow_patterns=["*.safetensors", "*.json", "*.txt", "*.model"], max_workers=4,
    )
    hf_hub_download("Contrastive-LM/CLM-v0.1-8B", "CLM_v0.1-8B.pt", revision=HEAD_REVISION)


if __name__ == "__main__":
    main()
