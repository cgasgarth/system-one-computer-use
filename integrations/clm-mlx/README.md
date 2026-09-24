# CLM on Apple Silicon

An optional serving adapter for the published [Contrastive Language Model](https://github.com/Contrastive-LM/CLM).
It uses MLX for Qwen3-8B last-token pooling and the upstream CLM projection heads,
vector cache, scoring rules, and HTTP API. It does not train a new model.

```bash
uv run --project integrations/clm-mlx --frozen clm-mlx --bits 4 --port 8700
```

Use `SYSTEM_ONE_URL=http://127.0.0.1:8700/v1/systemone` and
`SYSTEM_ONE_MODEL=clm-latest` in the harness. The service binds to localhost.
Set `CLM_API_KEY` to require a bearer token, then give the harness that token as
`SYSTEM_ONE_API_KEY`.

`--bits 0` keeps the BF16 encoder; `--bits 4` and `--bits 8` use MLX quantization.
The published projection heads remain unchanged. MLX embedding calls are serialized;
the upstream projection cache remains bounded to 64 MiB, and raw embeddings to
4,096 entries. Inputs over 2,048 tokens are rejected rather than silently truncated.

## Pinned inputs

| Component                    | Revision                                   |
| ---------------------------- | ------------------------------------------ |
| CLM code                     | `7956937c58ed5839c06ddc4dc6b6b61c3a3e4094` |
| `Qwen/Qwen3-8B`              | `b968826d9c46dd6066d109eabc6255188de91218` |
| `Contrastive-LM/CLM-v0.1-8B` | `87655cb835bd76fd66c2da78e1e3709f7fa11a94` |

The first run downloads roughly 16 GB of encoder weights and the CLM heads.
On the development M5 Pro, the 4-bit encoder used about 4.0 GiB of active MLX
memory. Conversion at startup reached about 15.3 GiB. BF16 used about 14.1 GiB
after loading. Leave room for startup conversion and other applications.

## Local response-time probe

Loopback HTTP medians on the M5 Pro, 10 requests per condition, MLX 0.32.2,
mlx-lm 0.31.3, and the 4-bit encoder:

| Input                                | State and actions uncached | New state, cached actions | Everything cached |
| ------------------------------------ | -------------------------: | ------------------------: | ----------------: |
| Short three-option question          |                     104 ms |                     50 ms |           0.30 ms |
| Captured calendar decision           |                     273 ms |                    182 ms |           0.32 ms |
| Captured note decision               |                     250 ms |                    164 ms |           0.30 ms |
| Captured flight decision, 16 options |                     590 ms |                    279 ms |           0.35 ms |

These are response times for fixed probe inputs, not full computer-task times.
The model was resident and kernels were warm. Reusing the entire state is much
cheaper than evaluating a new screen. The source probe matched 11 of 17 captured
reference choices; this is an integration check, not a general accuracy score.

This adapter is experimental. The published CLM server targets NVIDIA/vLLM;
this integration replaces its embedding backend with MLX while keeping the
released head architecture and scoring path.
