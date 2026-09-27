# Julia 1 on CPU

This integration loads the public [SupersonicLabs/Julia-1](https://huggingface.co/SupersonicLabs/Julia-1) snapshot. The snapshot contains Julia's Python source, encoder, tokenizer, and weights. There is no separate published PyPI package. The app imports the source from the exact resolved snapshot and checks the weight bytes against that snapshot's `inference-policy.json` SHA-256 before serving.

The runtime uses Torch CPU FP32 with four threads, Transformers 5.0.0, strict encoding, an 8,192-token total limit, a 512-token head, and `marker_only_head=False`. Torch and Python dependencies are fixed by `uv.lock`; the model snapshot revision is resolved at fresh download or explicit update and stored in the app's private artifact manifest. No MLX or GPU path is claimed.

Julia accepts 2–20 options per question. Its strict encoder rejects an option over 48 tokens, a question and options over the 512-token head budget, or a state over the total limit. The bridge reports these as capacity errors and does not truncate input. Model inference uses the private Unix socket bridge, with no local HTTP server. The published CPU evaluation used a 1,024-token total input limit; app behavior with longer states needs separate evidence.
