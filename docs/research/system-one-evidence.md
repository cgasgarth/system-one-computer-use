# Research basis and limits

The controller uses a finite set of observed actions. The decision model selects a tool and target, or Finish or Blocked. The text model supplies only an argument for a selected action. The implementation and ownership are described in [architecture](../architecture.md); current task checks are in [validation](../validation.md).

## Primary sources

- [CLM model card](https://huggingface.co/Contrastive-LM/CLM-v0.1-8B) and [source](https://github.com/Contrastive-LM/CLM) describe candidate scoring. A returned score is relative to its supplied choices; it is not a calibrated success probability.
- [Kev 4B model card](https://huggingface.co/jaredpalmer/kev-4b) identifies the published checkpoint used by the default local preset. The app pins a revision, so the changing public card does not define the installed bytes.
- [Anthropic's agent design guidance](https://www.anthropic.com/engineering/building-effective-agents) supports a simple tool-and-feedback loop. [Tool guidance](https://www.anthropic.com/engineering/writing-tools-for-agents) supports clear action names and useful tool results. These are design references, not performance evidence for this app.
- [BrowserGym](https://github.com/ServiceNow/BrowserGym) motivates repeatable browser environments. Browser fixtures do not establish native macOS reliability.

## Evidence rules

Treat a selected action, a returned tool call, and an observed effect as separate facts. Bind input to the current control and check a fresh observation before Finish. Grade stored results and unintended writes outside the model's own answer. A source-level test, fixed model choice, local browser task, and installed app each support different claims.

Small development replays found incorrect choices and false completion even when protocol responses were valid. The default Kev 4B selection reflects development results; it is not a broad model ranking. See [the model assessment](kev-clm-assessment.md) for provider-specific limits. Real task outcomes, including remaining unsupported workflows, are in [validation](../validation.md).

Generated probes and historical experiment notes are kept under ignored `runs/` for local audit. They are not setup instructions or a current benchmark.
