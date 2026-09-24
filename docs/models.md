# Models managed by the app

Open **Settings** from the menu. Selecting a local model downloads its files and starts its MLX service. The app manages the Python environment and runtime dependencies with its bundled uv executable. You do not need a separate serving terminal.

## Included presets

| Decision model | Precision          | Runtime                                          |
| -------------- | ------------------ | ------------------------------------------------ |
| CLM 8B         | 4-bit, 8-bit, BF16 | Published CLM heads with the MLX encoder adapter |
| Kev 0.8B       | BF16               | Upstream Kev MLX backend                         |
| Kev 4B         | BF16               | Upstream Kev MLX backend                         |
| Kev 9B         | BF16               | Upstream Kev MLX backend                         |

The text-generation preset is Qwen 3.5 2B at 4-bit precision. Only one decision model and one text model are loaded at a time. Changing a model stops the previous process before loading its replacement.

CLM downloads its pinned full encoder once, then quantizes it during loading when a quantized preset is selected. Startup can therefore use more memory than steady-state inference. The Kev presets use upstream BF16 weights; they are different model sizes, not quantized variants.

## Memory policy

- **Keep loaded:** retain the loaded models for subsequent tasks.
- **Unload after 5 minutes:** release idle model processes after five minutes.
- **Unload after each task:** release them when the task ends. Starting the next task loads them again.

Files remain on disk. These options control residency in memory. The model runtime's own request and embedding caches are available while its process remains loaded.

## External endpoints

Choose **Use an endpoint…** for either model role, enter the full inference URL and model ID, then save. Decision endpoints use the System One protocol; text endpoints use Chat Completions. Existing `SYSTEM_ONE_API_KEY` and `TEXT_MODEL_API_KEY` environment settings are forwarded as bearer credentials by the harness.

The app does not stop or unload external servers.

## Process ownership and data

The app owns a model-manager process and its local serving processes. Quitting the app closes its gateways and stops its model process groups. It does not stop unrelated services.

Settings, environments and logs are under `~/Library/Application Support/SystemOneComputerUse/`. Model weights use the Hugging Face cache. Local gateways bind only to `127.0.0.1`: decision requests on port 8700 and text requests on port 8080. The owned backend ports are 18700 and 18800.

Backend failures and setup failures are shown in Settings. Detailed logs are in the app's `logs/` directory; manager failures are in `model-host.log`.

Model lifecycle validation is separate from computer-task accuracy. A running endpoint does not establish that an agent completed a task correctly.
