# Kev and CLM assessment

Kev 4B is the default local decision model. Saved model selections remain in effect. The choice follows small development probes and supervised tasks, not a sealed comparison of general computer-use success. The provider-neutral controller also supports published CLM checkpoints and configured external endpoints.

The [CLM model card](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B) reports results that use specific verifier heads and candidate sources. Those results do not measure this controller with its released generic head. The [Kev 4B model card](https://huggingface.co/jaredpalmer/kev-4b) describes a different model and serving path. CLM 4-bit, 8-bit, and BF16 differ in precision; Kev 0.8B, 4B, and 9B differ in model size. A smaller model's speed is not a same-weight runtime gain.

On 14 frozen development requests, Kev selected 13 expected choices; CLM 4-bit and BF16 each selected 7. Those requests used a small chosen set of states, so the counts are not a broad model ranking or task-success rate. The two CLM precisions also made different choices on some inputs. The current controller uses each selected categorical answer without a confidence floor. The selected action executes after target and tool-argument validation. A selected Finish gets a fresh observation, with no separate completion judge. The actual saved result remains an independent evaluation question.

Local serving calls the model libraries through a private Unix socket bridge. CLM's encoder has a 2,048-token input limit in this deployment. The text model generates arguments only after a chosen action. The socket protocol and cancellation behavior are covered by transport tests; a passing protocol test says nothing about semantic accuracy. Current runtime details are in [model management](../models.md).

The compared requests were development data and included repeated prompts and small task families. They do not establish a held-out success rate, a general provider ranking, or a latency guarantee. Use matched inputs, resolved model revisions, and independent task graders for any future comparison.
