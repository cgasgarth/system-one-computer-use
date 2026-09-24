# Kev on MLX

This environment runs the upstream Kev server. No model training or custom Kev kernels are included.

The app pins `jaredpalmer/kev` to commit `09ff745d52a0f23954e3b0f5a608bf4c7c6aebb4`, sets `KEV_BACKEND=mlx`, and selects an immutable checkpoint revision from the model catalog. Dependencies are locked in `uv.lock`.

`download.py` resolves the selected adapter and its pinned base without loading GPU weights. The model manager then starts `python -m kev.serve` on its private backend port.

Sources: [Kev](https://github.com/jaredpalmer/kev), [released checkpoints](https://huggingface.co/collections/jaredpalmer/kev).
