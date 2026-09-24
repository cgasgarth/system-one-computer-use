# Project scope

Build and publish a provider-neutral System One computer-use harness. The core
must work with any compatible decision model through a typed adapter. CLM and
Jev/Kev are integrations and comparison targets, not core dependencies.

Custom model training and custom model runtime development are out of scope.
Use published models. Keep the optional CLM Apple Silicon serving adapter
separate from the Bun task loop, and measure its actual response times.

The harness must accept text tasks, read live native or Chrome controls through
CUA, let the decision model choose grounded actions, use a small text model when
text is needed, and verify observed results. Handy transcripts must enter through
the same task interface. Preserve model choice and provider configuration.

Keep source modules organized by responsibility. Validate external data with
Zod at boundaries, then pass trusted, strongly typed data internally. Use strict
TypeScript and Oxlint checks, zero warnings, and a 600-line source-file limit.
Keep generated artifacts and local research under ignored `runs/`. No GitHub Actions.

After task behavior is ready, produce a clean 4K local demo using actual app
screen recordings. Show the text task, visible actions, requests per second, and
total completion time. Use matched inputs for side-by-side model comparisons;
if 2048 is included, use the same seed and reach a 256 tile. Prefer responsive
local tasks when website latency would hide model behavior. Report measured
performance and avoid unsupported speed or quality claims.

Keep the original app colors and make the action sequence easy to follow. Do
not show memory graphs. Open the completed video in QuickTime for review. Do
not upload to YouTube; the user deleted the previous draft.
