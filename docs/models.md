# Models managed by the app

Open **Settings** from the menu. Selecting a local model downloads its files and starts its MLX service. The app manages the Python environment and runtime dependencies with its bundled uv executable. You do not need a separate serving terminal.

## Included presets

| Decision model | Precision          | Runtime                                          |
| -------------- | ------------------ | ------------------------------------------------ |
| CLM 8B         | 4-bit, 8-bit, BF16 | Published CLM heads with the MLX encoder adapter |
| Kev 0.8B       | BF16               | Upstream Kev MLX backend                         |
| Kev 4B         | BF16               | Upstream Kev MLX backend                         |
| Kev 9B         | BF16               | Upstream Kev MLX backend                         |
| Julia 1        | FP32               | Published 144M Julia model on CPU                |

The text-generation preset is Qwen 3.5 2B at 4-bit precision. Only one decision model and one text model are loaded at a time. Changing a model stops the previous process before loading its replacement.

Fresh downloads resolve the current published checkpoint. The app records the exact repository revision and a fingerprint of runtime files under its private `models/artifacts/` directory. A loaded model keeps that revision until it is unloaded. On launch, the app checks downloaded models for newer runtime files in the background. If an update is available, **Update model** in Settings downloads and loads it. The app does not change a loaded model during a task. A failed update check does not block a cached model; a failed update keeps the prior accepted manifest and attempts to restore the prior model. Benchmark records must name the exact resolved revisions used for every trial.

CLM downloads its resolved full encoder once, then quantizes it during loading when a quantized preset is selected. Startup can therefore use more memory than steady-state inference. The Kev presets use upstream BF16 weights; they are different model sizes, not quantized variants.
CLM resolves its published head and named Qwen encoder repository at download time and records both exact revisions. The upstream head does not declare an encoder commit; the recorded pair is the one actually loaded, not a compatibility guarantee. Kev checkpoints declare their base revision; the app resolves that exact base instead of replacing it with the latest base. Julia carries its own source, encoder, tokenizer, and weights in one repository snapshot. Its downloaded weight bytes are checked against that snapshot's published SHA-256 policy.

Julia's native API accepts 2–20 choices. The decision adapter pages larger target sets with short group labels and a full observed group map. It does not truncate choices or invent probabilities for the full target set. Julia's strict encoder also rejects an option over 48 tokens, a question and its options over 512 head tokens, or a state over 8,192 tokens; these are reported as capacity errors. The published Julia CPU evaluation used a 1,024-token total limit and a 512-token head, so this app's longer accepted state limit does not imply validated decision quality. Julia uses a private Unix socket for inference, like the other local presets; it does not start an HTTP server.

## Memory policy

- **Keep loaded:** retain the loaded models for subsequent tasks.
- **Unload after 5 minutes:** release idle model processes after five minutes.
- **Unload after each task:** release them when the task ends. Starting the next task loads them again.

Files remain on disk. These options control residency in memory. The model runtime's own request and embedding caches are available while its process remains loaded.

Typing in the task field or starting Handy dictation requests warm-up of both models. Draft warm-up has a five-minute idle grace period, even with the unload-after-task policy. Once an actual task ends, that policy unloads immediately. Repeated edits share the current model load.

## External endpoints

Choose **Use an endpoint…** for either model role, enter the full inference URL and model ID, then save. Decision endpoints use the System One protocol; text endpoints use Chat Completions. Existing `SYSTEM_ONE_API_KEY` and `TEXT_MODEL_API_KEY` environment settings are forwarded as bearer credentials by the harness.

The app does not stop or unload external servers.

## Process ownership and data

The app owns a model-manager process and its local serving processes. Quitting the app closes its sockets and stops its model process groups. It does not stop unrelated services.

Settings, environments and logs are under `~/Library/Application Support/SystemOneComputerUse/`. Model weights use the Hugging Face cache. Local inference uses private Unix sockets under `ipc/`, with one newline-delimited JSON request and response per connection. The model manager loads the selected model when needed and forwards the request to its socket. The Python bridge invokes the model library directly. Local inference does not bind TCP ports or use HTTP.

Socket directories are accessible only to the current user; socket files have mode `0600`. Messages have a 4 MiB size limit and are validated at process boundaries. A client disconnect cancels the pending request. Text generation stops through the runtime's cancellation hook; a decision forward pass can finish before the next request is processed.

Backend failures and setup failures are shown in Settings. Detailed logs are in the app's `logs/` directory; manager failures are in `model-host.log`.

Model lifecycle validation is separate from computer-task accuracy. A running endpoint does not establish that an agent completed a task correctly.
