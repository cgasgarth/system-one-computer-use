# CLM on Apple Silicon

This optional adapter serves the published [Contrastive Language Model](https://github.com/Contrastive-LM/CLM) through the app's private Unix socket bridge. It uses MLX for the Qwen3-8B encoder and the published CLM heads. It does not train a model.

Select a CLM preset in Settings. A fresh download resolves the current CLM head and named Qwen encoder repositories, records their exact revisions, and loads that recorded pair. Settings checks for changed runtime files on launch and offers an explicit update. The CLM head names the base repository but does not declare a base commit, so the manifest records the pair actually used; it is not a source-proven compatibility guarantee. A failed update leaves the prior accepted pair available.

`--bits 0` retains BF16; `--bits 4` and `--bits 8` quantize the encoder during loading. The published head architecture and scoring path remain in use. Inputs over 2,048 tokens are rejected rather than silently truncated. First loading may need more memory than resident inference because the full encoder is downloaded before quantization.

Python dependencies and the upstream CLM source package are fixed by `uv.lock`. Model revisions are resolved at download or explicit update time and recorded in private app data. Local inference does not start an HTTP server.
