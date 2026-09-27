# Kev on MLX

This environment uses the published [Kev](https://github.com/jaredpalmer/kev) model library with its MLX backend. It does not train a model or add custom Kev kernels. The upstream software dependencies are fixed in `uv.lock`; checkpoint revisions are resolved at fresh download or explicit update time.

`download.py` resolves the selected checkpoint and the exact base revision declared by that checkpoint, without loading GPU weights. The app records both identities in its private artifact manifest. The model manager then loads those exact cached assets through the private Unix socket bridge. It does not start a local HTTP server. A loaded model is not changed during a task.

Published checkpoint collection: [Kev models](https://huggingface.co/collections/jaredpalmer/kev).
