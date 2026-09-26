# System One harness references

Reviewed on 2026-09-25. These are design references, not performance results for this app or CLM. The temporary checkouts were read, not installed or executed.

| Reference                                                                                                           | Useful design                                                                                                                                                         | Boundary                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SystemOneHarness](https://github.com/HarnessRouter/SystemOneHarness/tree/ab8e8f08b4a6268c0633a474423d556599ee06a4) | Compile feasible actions and enumerable parameters; record explicit stop reasons; bound observation and history separately.                                           | Its core rejects free text. Our text-argument helper remains necessary.                                                                                       |
| [jev-ultrafast](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46)         | Ask operation and compatible target questions together; execute only the target selected by that operation; use a small text model only after text entry is selected. | Browser-only. Its examples begin at a supplied URL; they do not establish macOS app-launch behaviour. Its Jev timings do not establish local CLM performance. |
| [jev-use](https://github.com/shitianfang/jev-use/tree/541c86caabf1eeb0af929256649d460f2708cb42)                     | Typed reasons for uncertainty, unsupported requests, and provider failures; distinguish reported confidence from an estimated margin.                                 | Its LLM fallback can take over reasoning. That differs from this project's decision-model-owned loop.                                                         |

## Changes to evaluate here

- Offer actions supported by the current surface. An empty browser document has no page controls to move between with Tab.
- Separate operation selection from control selection. A long list of individual clicks and key presses should not overwhelm navigation or app launch.
- Put operation and target questions in one HTTP request where the backend supports it. Measure local CLM latency; one network request does not imply one encoder pass.
- Give each target its role, current value, and relevant context. Treat observed text as data.
- Verify writes against fresh state. A role named text area does not alone prove that the user can edit its content.
- Keep text generation limited to arguments for the selected tool. Validate its response before input.
- Test varied tasks in the installed app and verify the actual result independently. A DONE answer is not proof of success.

The references' fixed step budgets and automatic LLM takeover do not match the user's requirements and are not adoption targets.
