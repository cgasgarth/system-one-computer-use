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

Opening the task menu, typing in the task field, or starting Handy dictation requests warm-up of both models. Draft warm-up has a five-minute idle grace period, even with the unload-after-task policy. Once an actual task ends, that policy unloads immediately. Repeated edits share the current model load.

## Prompt cache preparation

After local models load, the app sends one background request for each of the text model's three exact system prompts: URL, general text, and search. Each request uses a fixed `Ready.` input and at most one output token. The output is discarded. No draft, voice transcript, screen data, or computer action is involved.

These requests let MLX store reusable system-prefix states through its normal generation worker. Real text requests use the same prompt bytes. Preparation runs once per loaded text process; a new process can prepare again. Starting a task or changing, updating, unloading, or closing models cancels unfinished preparation. A failed preparation leaves the task able to use an empty cache. It does not prevent Ready or delay task dispatch.

MLX's cache is bounded and can evict entries. A prepared prefix is not a permanent cache hit. The local text response reports actual reused prompt tokens in `usage.prompt_tokens_details.cached_tokens`. This measures model cache reuse, not a stored response.

Kev's current cache matches the complete encoded task and screen state. An incomplete task or a dummy system prompt cannot seed a later decision. The app loads Kev early and makes the real decision when its input is ready. These warm-up paths do not change decision prompts or action policy.

### Bounded cache measurement

With Qwen 3.5 2B 4-bit already loaded, five paired requests per prompt type gave the following results. The checkpoint was `674aaa7240b91e8012fcad5d791b7dfe5ba90207`, with MLX 0.32.2 and mlx-lm 0.31.3. Each pair used an empty cache or a cache seeded through the normal generator. All 15 output pairs matched.

| Text prompt | Empty-cache median | Prepared-cache median | Reused tokens |
| ----------- | -----------------: | --------------------: | ------------: |
| URL         |           233.1 ms |              188.0 ms |           192 |
| General     |           204.4 ms |              160.7 ms |           165 |
| Search      |           210.3 ms |              163.2 ms |           187 |

Preparation itself took about 0.50 seconds across all three prompts. It moves work before Start; it does not remove that work. Immediately after preparation, active Metal memory increased by about 179 MB and the cache reported about 218 MB across 10 entries. These are small, local text-generation measurements, not task-completion speed or decision-quality results. Later requests can evict cached entries.

## External endpoints

Choose **Use an endpoint…** for either model role, enter the full inference URL and model ID, then save. Decision endpoints use the System One protocol; text endpoints use Chat Completions. Existing `SYSTEM_ONE_API_KEY` and `TEXT_MODEL_API_KEY` environment settings are forwarded as bearer credentials by the harness.

The app does not stop or unload external servers or send them speculative prompt-preparation requests.

## Process ownership and data

The app owns a model-manager process and its local serving processes. Quitting the app closes its sockets and stops its model process groups. It does not stop unrelated services.

Settings, environments and logs are under `~/Library/Application Support/SystemOneComputerUse/`. Model weights use the Hugging Face cache. Local inference uses private Unix sockets under `ipc/`, with one newline-delimited JSON request and response per connection. The model manager loads the selected model when needed and forwards the request to its socket. The Python bridge invokes the model library directly. Local inference does not bind TCP ports or use HTTP.

Socket directories are accessible only to the current user; socket files have mode `0600`. Messages have a 4 MiB size limit and are validated at process boundaries. A client disconnect cancels the pending request. Text generation stops through the runtime's cancellation hook; a decision forward pass can finish before the next request is processed.

Backend failures and setup failures are shown in Settings. Detailed logs are in the app's `logs/` directory; manager failures are in `model-host.log`.

Model lifecycle validation is separate from computer-task accuracy. A running endpoint does not establish that an agent completed a task correctly.
