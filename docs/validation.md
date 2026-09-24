# Validation

## Installed macOS app, 2026-09-24

Each request below was entered into the actual menu-bar dropdown. The app used
local CLM-8B (4-bit MLX) and Qwen3.5-2B for task planning. Results were checked
against task traces and visible app screenshots, not only completion messages.

| Request                                                      | Observed result                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| open chrome and go to open table                             | Search result selected; opentable.com opened                       |
| Type Chicago into the Location, Restaurant, or Cuisine field | Chicago entered into OpenTable's location textbox; no submission   |
| go to wikipedia                                              | A localized Wikipedia homepage opened; domain verified             |
| Open https://example.com                                     | Example Domain opened in the same Chrome session                   |
| open Chrome                                                  | Existing Chrome tab observed; task completed                       |
| open my calculator                                           | Calculator brought forward                                         |
| open my calendar                                             | Calendar opened and observed                                       |
| Stop during pending navigation                               | Dropdown Stop closed worker and driver; no later decision executed |

This run found and corrected several real failures: quoted YAML link labels,
frame-qualified Playwright references, nested textbox values, select menus
misclassified as text inputs, acting on an old page before planned navigation,
and false completion from text already present on a page. Unit tests cover these
cases. Earlier failed attempts are retained locally under ignored `runs/qa/`.

These checks are examples, not an accuracy benchmark. Website layout, language,
loading time, and model decisions can vary. Wikipedia's localized result shows
that language selection still needs improvement. Complex planning and arbitrary
canvas tasks remain unvalidated.

## Repeatable checks

```bash
bun run check
bun test
bun run format:check
bun run app:install
```

After changing a driver or planner, repeat the affected installed-app requests
and inspect the actual destination or field value. Verify a second request in the
same browser session, connection-page cleanup, and Stop while work is pending.
Do not treat an empty snapshot or a completion message as proof by itself.

Completed and failed app traces are kept in
`~/Library/Application Support/SystemOneComputerUse/runs/`. They include the
parsed plan, actions, probabilities, timing, and failure details. Screenshots and
local test servers stay outside version control. Close test tabs after validation.
