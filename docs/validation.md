# Validation

## Checks for the decision-owned loop (2026-09-25)

- 56 automated tests pass, with strict type-aware lint and the 600-line source limit.
- Swift 6 release compilation passes. The task and Settings views were rendered and inspected. Rendered views do not prove physical keyboard or speech behavior.
- The installed dropdown accepted typed text, enabled Start, selected desktop tools, showed live metrics, and accepted Stop. The stopped session was saved with status `stopped`.
- CUA lifecycle checks reproduce rejection after an ended transport session. The fix starts both the implicit discovery session and the named input session before reading state, then closes both with the task. Three fresh live connections each passed repeated desktop reads. Installed Start → Stop → Start checks passed live observation on both runs; both turns were saved as stopped. This check does not establish task-completion accuracy.
- Session tests cover the one-hour boundary, process restart, explicit resume/new selection, three-session retention, and concurrent turn updates.
- Loop tests cover switching after observation failure, switching after saved-tab restoration failure, terminal choices on both surfaces, and Stop before a pending decision starts its action.
- Warm-up tests cover draft retention under the cold policy and unloading after an actual task releases the models.
- The Handy state machine passes Hold, Auto threshold, Toggle, repeat-edge, and cancellation checks. The installed Handy setting was Hold. Physical dictation and final transcript delivery still need an end-to-end check.
- Dictate was tested during a running task and again after cancellation. Handy logs confirmed microphone samples on both starts and return to idle on both cancellations. The user confirmed that the physical global shortcut starts listening on its second use while a task runs.

## Live model and driver results

CLM selected the expected initial surface for six prompts against a captured desktop listing: Messages, Calendar, and Finder selected desktop; OpenTable, Wikipedia, and Google search selected Chrome. This is a small routing check, not a general task-success benchmark.

A supervised live run opened Messages. It did not complete the requested conversation lookup: CLM repeated application-opening choices. Earlier app-selection tests opened unrelated apps; those tests were stopped and their apps closed. The current loop must not be described as reliable for arbitrary native workflows.

A later supervised Messages run used the user's exact request and completed in four model decisions. The model rejected an unrelated window, opened Messages, and stopped. A separate native accessibility read confirmed that the requested conversation was selected, its latest outgoing message was visible, and the composer was empty. No message was sent. Six local completion replays also distinguished the requested conversation from a different one, empty from filled input, an open app, and an unfinished file chooser. These checks cover those cases only.

The installed menu-bar app also completed that exact request in four decisions. This UI check first caught a small tooltip being offered as a window; transient windows smaller than 120 × 60 points are now excluded. The final menu showed Completed, with 277.1 ms median decision latency for that run. The conversation remained visible after the task menu closed. This run does not establish accuracy for other contacts or tasks.

The earlier installed-menu Calculator test needed Stop. The updated source completed a live “Open Calculator on this Mac” run in three decisions, with a fresh native window listing confirming Calculator. A browser navigation run reached example.com and stopped. A local Chrome form run filled the Message input with Hello and stopped in six decisions; both the driver snapshot and native Chrome accessibility view confirmed the value. The packaged worker was then tested from an isolated session directory: it selected desktop tools, selected the Calculator window, and completed in four decisions. The updated menu opened, accepted text, and retained the restored user draft. These are small supervised checks, not a general success-rate benchmark.

The tests reproduced a focus cycle, then verified that the guard stops repeating Tab in the same states. Playwright key names and flags before element references are now handled correctly. Truncated text output is rejected before typing. Native Command+O opened a live Preview file chooser with readable Search and Open controls.

The full “load a random image in Preview” task still failed in a supervised model run by selecting an unrelated window. The driver check does not establish successful image selection. Native window routing and broader workflows need more work.

The Chrome extension supports saved-URL restoration inside the current connection's tab group. A new connection creates a separate group. A live reconnect test correctly reported the old tab as unavailable. The user must move that tab into the new group, or begin a new session. Duplicate saved URLs are reported as ambiguous. Unit tests check URL verification before further interaction.

The old text-planner workflow has been replaced. Results from that workflow do not validate this loop.

## Repeatable checks

```bash
bun run check
bun run test
bun run format:check
bun run app:install
```

After changing a driver or decision prompt, repeat affected tasks with the real model and inspect the actual app result. Test a follow-up in the same connection, Stop during work, and a failed tool followed by a different tool choice. A model's Complete choice is not independent proof of success.

App session files and traces stay under `~/Library/Application Support/SystemOneComputerUse/`. Local QA traces, captured observations, and screenshots stay under ignored `runs/qa/`. They can contain private application content and must not be committed.

## Model startup events (2026-09-25)

Managed servers now report startup through their stderr stream: Uvicorn's bound-port message for CLM/Kev, and MLX-LM's HTTP startup message for the text server. These adapters use the pinned runtime versions. If an upstream message changes, startup times out with a log path instead of silently reverting to repeated HTTP checks.

After the event, CLM/Kev receive one HTTP readiness check. The text server receives one one-token completion because its HTTP listener can start before the model-loading thread finishes. Cancellation, process exit, and startup timeout end the wait. Task progress and model status already use process streams. Idle unloading and safety timeouts are one-shot timers; the model's explicit Wait action still has a short delay.

Live source checks loaded the existing CLM 8B 4-bit and Qwen 3.5 2B 4-bit models, reached Ready, and unloaded both owned processes. Total prepare-to-ready times in that run were 4.03 s and 2.43 s respectively, with cached files. These are startup checks, not inference speed benchmarks. Kev's pinned Uvicorn startup path was inspected but not live-loaded in this check. Five process tests cover split event delivery, continued logging, early exit, cancellation (including cancellation before attachment), and timeout. The suite has 61 passing tests.

## Native editor and window selection (2026-09-25)

The Notes failure trace contained a real Notes window. The abstract window-selection action cleared it, while the short accessibility snapshot omitted the editor. Window choices now name the available windows directly and retain the current target. Native reads include more controls and check whether selected text is writable. Editable fields appear first in model context, with explicit labels and current values. These changes are generic to native apps.

With a blank Notes editor, the source harness completed the exact request “Open my notes app and type hello” in three decisions: desktop/app selection, text entry, and completion. A separate read confirmed `hello` in the editor. The completion replay accepted the filled editor and rejected both an empty editor and the wrong text. The complete suite now has 63 passing tests, and strict checks and the macOS build pass.

The first installed UI test exposed a separate Accessibility requirement. After the user enabled System One Computer Use, the installed app completed the exact Notes task in four decisions: select desktop/open Notes, create a note, type `hello`, and finish. A separate native app read confirmed `hello` in the editor. The trace was `task-1790353948117.json`; total task time was 13.53 s. This validates that workflow, not general native-task reliability. No permission was changed by the agent.

## Menu layout review (2026-09-25)

Reviewed the live Habit Garden and Hourglass Timer studies from [MiaAI-Lab's Opus 5.5 collection](https://github.com/MiaAI-Lab/Claude-Opus-5.5-100-HTML-Files), including the timer's pause/resume state. The native menu now puts task entry first, uses quieter controls below it, keeps status space fixed, and replaces Start with Stop in the same location during work. Model idle events retain the last task result. Settings use the same panel width.

Light/dark, idle, running, and error previews were rendered and inspected. The installed menu accepted text, displayed the running state, and stopped an active task; its user draft was restored. The UI rebuild changed the app's ad-hoc code signature, and native access was rejected again even though Settings still showed the switch on. The current build's end-to-end task check remains pending renewed Accessibility approval. Stable signing is needed for permission continuity across development rebuilds; this machine has no valid code-signing identity. No signing trust or macOS permission was changed by the agent.

## Menu preloading and completion indicator (2026-09-25)

Opening the task popover, returning from Settings, or starting dictation immediately requests model warmup. These entry points bypass the typing debounce, while LocalModels still combines calls during an in-progress load. The status item spins during task preparation, task execution, and transcription. A successful task displays a checkmark for five seconds, then restores the usual cursor icon. Starting a task or dictation cancels the old completion timer. Stop and failures return to idle without a success checkmark.

A native test checks processing state, completion before/after five seconds, cancellation of the old timer by a new task, and listening state. Run it with `bun run test:native`. It passed, along with 63 Bun tests, strict checks, and the macOS release build. The update is installed. After the user approved Touch ID, the existing app permission entry was removed and re-added through System Settings: toggling alone retained an old code requirement, as confirmed in the macOS TCC log. The installed app then opened Calculator and completed in two decisions; an independent window listing confirmed the visible Calculator window. For preload verification, retention was temporarily set to unload after each task. Both model servers were confirmed stopped after completion. Opening the task menu without typing then started both servers, and Settings reported both Ready. The original five-minute retention setting and the user draft were restored.

## Window-event failure and honest action counts (2026-09-25)

The captured Messages contact-lookup run (`failed-1790367498479.json`) made 235 decisions: one desktop selection and 234 repeated app requests. Each failed before launch because AX window-event registration could not complete. A live helper probe reproduced AX error -25204. The previous action-rate calculation counted these failed attempts, while repeated model inputs could use the encoder cache and return about 1 ms decision latency.

Window-event observation is now advisory when an application cannot register it. An existing window is checked first; otherwise the app-opening action can proceed and the driver reads the resulting desktop. Actual missing Accessibility permission still prevents execution. App/URL request repetition now participates in the existing per-state progress guard. There is no task-wide action limit.

Action rate now counts explicitly recorded tool executions that returned successfully. Errors, unchanged results, waits, tool-set selection alone, and terminal decisions do not count. Decision latency remains model timing and includes cached decisions; it is labelled “Median decision · ms”.

67 tests and strict checks pass. Live source launch reached a visible Messages window. The installed app then completed “Open Messages” in two decisions with one performed action and no tool errors (`task-1790368023210.json`); a separate driver listing confirmed its window. The menu showed 271.3 ms median decision time and 0.56 successful tool actions/sec in that small run. The complete contact lookup was not retested. The prior OpenTable draft was restored.

## Notes-to-Calendar regression (2026-09-25)

The user's Calendar request restored the previous Notes window and exposed its controls before resolving the new request's app. CLM selected New Note and Checklist repeatedly. Every new note changed the observed state, so the existing per-state repetition guard did not catch the sequence. The five unwanted notes were moved to Recently Deleted; existing notes were preserved.

The task loop now binds the requested app before exposing saved native controls, including when Desktop is explicitly selected. A same-app follow-up retains its matching window. Tests cover both routing modes and the Notes follow-up. Real text-helper checks selected Calendar for the calendar request, Notes for a note follow-up, and Messages for a messages request.

Further live checks found two driver defects: controls behind an active popover competed with its form controls, and native text insertion appended on retries. Native snapshots now scope to the presented subtree, retain parent links, and distinguish actual field values from placeholders. Field writes use CUA's set_value operation with read-back verification; repeated desired values are no-ops. Reported AXConfirm operations are exposed as exact-element actions. A refused ambiguous background key may use CUA's documented, guarded foreground route for the same window; other failures remain errors.

The action question now includes the current goal. Click candidates receive a separate operation-match check; ambiguous matches below 0.8 are skipped. This is a conservative execution gate, not a calibrated accuracy guarantee, and adds decision requests. Open-dialog field values are explicitly identified as possible drafts in the completion check.

Controlled Calendar verification exposed four malformed test events before the field replacement fix. All four were removed. The final real-model run, with the prior Notes session supplied, created one `test event` on September 25, 2026 from 11:00 PM to 11:30 PM in Home, with no invitees. A separate Calendar accessibility read and screenshot verified the saved event and both times. The run took seven decisions, including two text no-ops. No Notes actions occurred in this final run.

76 automated tests, strict checks, and the macOS release build pass. The update is installed; its read-only `Open Calendar` check completed in two decisions. The original calendar-task draft was restored. Broader task success rates and the added verification latency have not been benchmarked.

### Online harness design review (2026-09-25)

Primary sources, accepted changes, rejected experiments, and limits are recorded in
[the harness research note](design/harness-research.md). A real local CLM replay used
14 synthetic observations without executing computer tools. Complete/continue
classification improved from 12/14 to 13/14; HTTP calls fell from 35 to 22. These are
development cases, not task-success or latency benchmarks. One wrong-document
follow-up still produces false completion. `bun run eval:decisions` exposes this
failure with a nonzero exit code. No reliability claim is based on the unit tests.

## Extended real-model testing, September 25, 2026 evening

Tested with the app-managed CLM 8B 4-bit and Qwen 3.5 2B text helper on this Mac.
This supersedes the earlier research-only completion results above.

Observed failures included guessed link paths, premature completion on a document
list, repeated typing after a successful write, unneeded keyboard navigation,
false blocked decisions despite a Save control, and a wrong-document follow-up.
These were found through real Chrome tasks, not inferred from unit tests.

Retained changes:

- The text argument helper receives exact observed link URLs.
- System One selects an operation, then a compatible target. Both distributions
  are recorded. If every target fails verification, another operation is offered.
- Link descriptions state their effect. Keyboard alternatives are offered only
  where focus/dialog state supports them and direct controls do not cover them.
- Verified field values suppress redundant typing until the field value changes.
- Completion reads current observation and historical request context. Successful
  tool prose is kept in traces and the text helper's context rather than repeated
  in every decision state. Current tool errors remain visible to the decision model.
- Follow-up completion checks the intended target. A mismatch restricts that turn
  to target correction before editing. Session context retains the prior target URL.
- Repeated failed surface switches are guarded. A stale saved tab does not prevent
  observing and using the current browser surface.
- A Finish selection without any observed target cannot become success. The 0.6
  completion gate was restored after a live false-positive; it is a heuristic,
  not calibrated confidence. The earlier removal was not retained.

### Latest complete browser run

`bun run eval:browser` runs a disposable local workspace in real Chrome, with real
model decisions and independent saved-data checks. Only the test fixture contains
its document names and expected contents; the harness contains no site workflow.

| Task                                      | Result                                    | Decisions | Total time in this run |
| ----------------------------------------- | ----------------------------------------- | --------: | ---------------------: |
| Open Roadmap Review                       | Correct URL/title; no saves               |         2 |                 822 ms |
| Replace its text and save                 | Exact requested value; one save           |         4 |               2,283 ms |
| "Open it again" from a different document | Returned to Roadmap Review; no extra save |         3 |               1,876 ms |

These are single-run development results on local pages, with resident models and
partly warm embedding caches. They are not held-out accuracy or speed benchmarks.
Earlier runs with the same tasks failed and remain in ignored `runs/qa/night-test`.
An additional Autumn Plan edit, a Contacts lookup, and native Calculator/Calendar
launches passed separately. Native testing did not create or edit calendar events.

The final installed app opened Calendar in two decisions without errors after its
existing Accessibility entry was refreshed for the new ad-hoc code signature.
Stop was verified in a fresh running browser session: UI status became `Stopped`,
with zero tool actions recorded for that request. The original user draft was
restored. The 22 local test tabs were closed; the original Chrome tabs were kept.

The fixed-observation development suite now passes 14/14 after separating its
historical-context and tool-feedback inputs to match the new interface. This does
not establish full task reliability. Earlier 12/14 and 13/14 counts used different
prompt/input layouts and must not be treated as comparable accuracy benchmarks.

Known limits remain: small development task coverage; heuristic verification;
no broad provider comparison; no complete native drag/scroll/canvas support;
and unstable Accessibility grants across ad-hoc-signed rebuilds. No model was
trained, no hosted text planner was added, and no video or upload was performed.

## Read-only Calendar diagnosis and local QA, September 26, 2026

The installed app opened Calendar, then chose the file Open command twice and
switched to Reminders while handling a request for a new Tennis calendar item.
That run stopped in Reminders. A later read-only Calendar search showed no Tennis
result under Today. No test in this section created a user Calendar event.

A later source-driver capture is not the installed failure snapshot. It exposed
an actionable **Add Event** button, the file Open option, and an app-switch
option. On that frozen capture, changing only the file Open description did not
change the selected operation. A flat choice over 75 actions put Add Event at
rank 56 with CLM 8B 4-bit. A paired read-only request to the pinned Kev 4B
checkpoint put Add Event first. These are local model choices, not completed
Calendar tasks or a general model ranking.

Eight fixed app-target questions showed that a simple S1 choice over 114
installed names plus stay/unavailable options missed all eight expected targets.
The current Qwen app-name helper returned exact names on six valid fixed cases.
In a separate replay of the failed app-switch argument, the old progress-aware
prompt returned Reminders and the revised argument-only prompt returned Calendar.
No app was opened by those replays.

A disposable Chrome page changed after a real model Finish choice. The source
harness rejected the stale Finish, recorded the fresh page, made another
decision, and completed on the correct page with zero writes. In three other
local form cases, Cancel saved nothing and passed; Create/Save and an unsaved
draft did not meet their requested final states. Their persistent write counts
were zero. These are small development checks on local pages, not a task success
rate. Private traces and exact request bodies remain under ignored `runs/qa/`.

### Installed app check after the grant refresh

The updated bundle was installed from `38d2ee2`. After the user approved the
macOS authentication prompt, its stale Accessibility entry was removed and the
same app was added again. The installed request **Open Calendar on this Mac**
completed in two decisions: open the application, then Finish. CUA separately
confirmed a visible Calendar window. No event was created or edited.

The current user draft, model preferences, Auto/Automatic selections, and session
files were restored from fresh backups. The app was restarted into an idle Ready
state so the restored draft did not show the test's completion status. This
confirms installed native access and app launch; Calendar event creation and the
failed form workflows above remain unresolved. Native menu discovery is still a
documented prototype, not a production action.

### Settings permission check

An installed Settings build (binary SHA-256 `dd26a0179e32b82e9b234980574952ae0d210eaa079cd9dd57744315f7ea71e2`) showed **Needs access** for System One Accessibility after the ad-hoc rebuild, **Granted** for CUA Driver Accessibility and Screen Recording from the driver's own daemon, and **Check in macOS** for Handy Microphone. No permission was changed. The Accessibility and Microphone Open buttons reached their macOS privacy pages. A separate preview with an injected missing Screen Recording state reached the Screen & System Audio Recording page without changing CUA's grant.

The default Settings view kept Back and Save visible. With both endpoint forms open, Back and all four fields were visible at the top; the enabled scroll bar moved to Save and Quit at the bottom. The app restarted Ready with the user draft restored. Screenshots are under ignored `runs/qa/overnight/settings-install-backup/permissions-final-expanded-{top-clean,bottom}.png`. This check covers Settings status and layout, not a native task run.

### Settings layout revision

Settings now has General, Models, and Permissions tabs in a fixed-size menu popover. Back, section navigation, and Save remain visible while only the body can scroll. Permission owners and capabilities use separate lines; confirmed grants use secondary text, and missing grants retain an Open Settings link. The idle-memory explanation stays beside its control in General.

The installed revision was visually checked in all three tabs. Both expanded endpoint forms fit in the first layout check. The final build removed the permanent scrollbar and Back capsule; Recheck and Save with unchanged preferences were exercised. The task draft was restored, model preferences were unchanged, and existing session files retained their hashes. Screenshots are in ignored `runs/qa/settings-redesign/`. Strict checks, 112 Bun tests, native permission/status checks, and the release build passed. This is Settings validation, not a task-reliability result.

### Messages recovery and signing checkpoint

The failed Messages request took 18 decisions in 19 seconds. The harness offered a guessed Command+O action, later excluded text input and most native list targets during target correction, and rendered a raw URL validation error. The guessed file-opening action path is removed. Target correction now retains observed actions and provides mismatch feedback while preserving action and commit checks. Actionable native rows can use observed descendant text as their label. Invalid URL output produces a readable error; the status label flattens line breaks and retains the full tooltip.

Strict checks, 115 unit tests, native tests, and Swift 6 app typechecking passed. A read-only live CUA inspection found AXPress on the current requested conversation's static-text element. The old compact trace omitted capability metadata, so this does not establish its capability at failure time. A reduced synthetic CLM probe with only Search and Message inputs (no actionable conversation row) chose Message with both the typo and corrected name. This remains a model-selection failure; it is not evidence of reliable typo recovery. No new live task was executed.

The installer now requires a certificate-backed identity and stages/verifies updates before replacement. The machine had no valid signing identity during this check. The missing-identity path left the installed app unchanged. Signed probes, upgrade permission retention, and the complete Messages workflow remain unverified. The current changes were not installed; work stopped at the user's 94%-remaining usage limit.

### Local signing and browser recovery follow-up

A dedicated local certificate was subsequently installed in the login keychain with user-scoped code-signing trust. Two installed signed builds had different binary hashes and the same certificate-bound designated requirement. The installed app and its native helper reported Accessibility granted before and after the update, without another grant. CUA retained Accessibility and Screen Recording access. This validates signing continuity, not task reliability.

The later Chrome request failed to restore its saved tab, received invalid URL arguments, and then switched between unrelated windows until the user stopped it. Recovery changes now use a blank tab when the saved URL is missing or ambiguous, require a complete URL with a single correction attempt, retain errors and recent actions in model context, and track repeated window destinations across source windows. Operation selection retains alternative tools, and window checks explicitly distinguish requested websites from similarly named applications. Focus and geometry changes do not reset the repeated-action state.

At the user's explicit request, no tests, static checks, or task demonstrations were run for these recovery changes. Their effect on model task success is unverified.

### General navigation and outcome recovery

The same 14 frozen decision requests produced 7 expected choices with CLM 8B q4 and 13 with Kev 4B. Both missed one Create-project effect question. Corpus SHA-256: `7b13e24e9ea5505d5f641d674af37cd01a53f03cb2834d51d162fb6118e97ebd`. These are development decisions, not an overall task-accuracy score. Three native cases were excluded from the paired comparison because source changed between their runs. `scripts/evals/provider-compare.ts` records this distinction.

General fixes address missing native menu and row capabilities, search-field identity, exact URL arguments, unrelated operation fallbacks, and completion checks that vetoed correct results. Native window replacement has a single bounded rediscovery. Native document URLs are read from the exact Accessibility window, not inferred from its title. Source changes contain no application-name or website-name task routing.

Observed outcomes with Kev 4B:

| Task                                       | Result evidence                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Edit and save a local browser document     | Completed with the exact new text and one stored write                    |
| Fill an unsaved browser draft              | Completed with the requested value, dialog open, zero stored writes       |
| Browser result changes before Finish       | Rejected the stale result and returned to the requested document          |
| Open a local video from a different folder | Completed through observed native controls; exact final file URL verified |
| Open a native app with older task context  | Completed in the requested app                                            |

The latest file run used six steps in 17.6 seconds. CUA 0.28.2 reported AXOpen errors despite folder/file transitions taking effect; those errors remain in the trace. The harness re-observed the result and verified the file URL before completion. This does not establish that all native actions are reliable. The test used an owned two-second generated clip and did not open personal media.

CLI evaluations now prepare unloaded models before their task timer, matching the app's preparation stage. An earlier zero-step timeout was a cold-model preparation failure in the evaluation runner. Task timings exclude weight loading and are not cold-start benchmarks. Raw traces remain under ignored `runs/qa/recovery/` and `runs/recovery/`.

#### Installed-app verification

The signed installed build completed `Open https://en.wikipedia.org/wiki/Chicago in Chrome.` in two decisions (9.9 seconds) and `Open the Optimus player app for me` in two decisions (1.6 seconds). These requests were submitted through the native task dropdown. The saved traces report the matching final Chrome URL and native app/window. System One and CUA Accessibility remained Granted; CUA Screen Recording remained Granted after replacement.

The final browser fixture reruns completed edit/save in four steps (2.5 seconds, one exact stored write) and an unsaved draft in two steps (1.0 second, zero writes). The full source gate passed 151 tests, strict type-aware lint, the 600-line limit, formatting, and Swift/native checks. These checks cover the listed flows; arbitrary canvas and multi-app workflows remain unvalidated.

An installed-launch check caught a Swift toolchain default targeting macOS 28 on a macOS 27 host. The installer now pins macOS 15.0 for all native binaries and sets the matching bundle minimum. The rebuilt signed app launched successfully. Temporary local web pages and the generated clip were cleaned up; Chrome blocked closing one blank tab while another extension UI was active.

### Local sockets and decision-flow repair (2026-09-27)

Two cancelled native requests exposed a missing trace boundary: they recorded an initial desktop choice, but no details for the subsequent 28–94 seconds. One opened the wrong application because a text helper supplied its name. The decision model now selects an exact installed application. Visible controls share a target set rather than hiding text inputs behind a separate operation. Ordinary action relevance is not judged a second time by the same model; persistent-effect authorization remains. All semantic checks use their selected categorical answer, without probability cutoffs. Internal retries are bounded; there is no total task action limit.

On a fixed development app-selection input, Kev chose the intended application in four of four flat-list cases, including reversed option order, versus two of four with 24-item grouping. A separate source-stable, sanitized seven-case decision probe selected the expected application, search field, or existing result. These are development probes, not held-out task accuracy. An initial live attempt still failed and exposed the need to group visible controls together. A later QA guard incorrectly refreshed CUA tokens before clicking; that run is not counted as a task pass.

A corrected, supervised live Messages task then opened the requested existing conversation in 12.8 seconds: four turns, 13 model requests, and zero QA guard interventions. No message was sent, drafted, deleted, or created. Subsequent changes bound completion context to one shared budget and ignore focus/geometry changes during terminal freshness checks. The final installed menu app repeated the request successfully in 2.6 seconds with three turns and five model requests; the conversation was already open, so the timings are not a paired speed comparison. Its saved surface matched the requested conversation. Private observations stay in ignored local traces.

Managed inference now uses private Unix sockets with JSON frames. Real Kev, CLM, and text-model requests passed through the Python bridge. A cancelled text request stopped generation and a following request succeeded. A stopped worker preserved its active phase, request counts, model identity, and timing before exit. Metrics count actual model requests and include waiting time in action throughput. Tests cover fragmented frames, invalid responses, cancellation, stale sockets, live-listener protection, failed-start idle cleanup, queued warm-up during shutdown, and detached descendant cleanup.

Installed checks found and repaired two additional lifecycle problems: queued warm-up after Quit, and an editable Python package pointing into the development checkout. Serving now uses uv-managed Python directly; runtime preparation installs non-editable packages from the final app bundle. Both installed models reached Ready. The installed model processes had no TCP listeners. The local signing requirement remained unchanged and Accessibility/Screen Recording grants persisted. The final unit suite passed 181 tests, plus strict checks and native/Swift checks. This validates the listed paths; it does not establish reliability for arbitrary computer tasks.

### Consult controller repair: action-first selection

The completion preflight passed six small synthetic labels, then failed four of
seven disposable browser workflows. It was rejected. The deployed design asks
System One for the next action first, including Finish and Blocked. Finish checks
for an unobserved requested persistent result and requires a fresh observation.
No confidence floor or extra target-completion judge is used.

The same seven browser cases with action-first selection passed six: open a
document, fill an unsaved draft (zero stored writes), edit/save (one exact write),
click a replaced button (one effect), select a duplicate-label option (one exact
write), and keep an already-open editor unchanged. The context-only follow-up
case still selected Blocked. It supplied prose history without the typed saved
surface. That failure is retained in the report.

A separate serialized SessionStore/reconnect test restored the saved document
after the current page changed. Both tasks completed in two turns, with five and
three model calls respectively. All seven storage/effect counters had zero delta.
The test verifies the actual saved-surface flow; it does not replace the failed
context-only case or establish broad task accuracy. Artifacts are under ignored
`runs/qa/recovery/live-kev-action-first/` and
`runs/qa/overnight/session-followup-reconnect-f20b6fec-7854-4f59-90dc-1085fa2a10be.json`.

Target descriptions and input binding now carry observed container identity.
Progress tracking follows the same named container through row reorder and does
not transfer filled-field state between ambiguous rows. Explicit and saved URLs
are selectable actions; surface selection does not secretly navigate. Same-target
redirect retries are tracked across changed page states.

Final review also found Stop races between a fresh read and an action. The
harness now rechecks cancellation immediately before text entry, navigation,
app launch, and activation. Focused keyboard options remain available beside
unrelated buttons. Key execution and retry tracking use stable focused-field
identity across snapshot token changes, and reject changed or ambiguous focus.
Return follows the persistent-effect authorization path.

The keyboard follow-up rerun passed the unsaved-draft and already-open-editor
cases. The edit/save case stored the exact requested text once, then the secondary
pending-result judge vetoed the primary Finish choice despite visible saved
text and status. That is a controller false negative. The secondary judge was
removed; the final policy trusts the main Finish choice after checking that the
screen is still current. Earlier results above retain the policy used in each run.

With direct Finish selection, the same three localhost cases all passed: edit/save
(four turns, 1.72 s, one exact document write), fill-unsaved-draft (two turns,
623 ms, no stored writes), and already-open editor (one turn, 173 ms, no stored
writes). No unrelated write counter changed. Source SHA-256:
`f106ce59359696171e119904d8170e4fb624c0013fa5bbeb9df45b01f6e5e6a1`.
Artifacts: ignored `runs/qa/recovery/live-keyboard-direct-finish/`. These task
times exclude model loading. Keyboard input itself was covered by focused tests;
the three live runs did not need to select a key action.

The final signed app completed “Open Calculator on this Mac.” from the native
menu in 2.08 seconds, three turns and four model requests. Median model request
time was 175.5 ms. The trace and a separate native window read both identified
Calculator. Kev 4B and Qwen 3.5 2B reached Ready through managed Unix endpoints.
System One Accessibility, CUA Accessibility, and CUA Screen Recording remained
Granted with the same certificate-bound signing requirement; no grant was added.
The installed worker SHA-256 is
`34f60d2d7eef56b3bcafc5fb9eb5dd86048539e231752d8304e388c6a3ac1e5b`.
All four bundled entry points matched a fresh source build. Final checks passed
195 Bun tests, seven Python bridge tests, strict typing/lint, formatting, the
600-line source limit, and native status/permission tests. All owned QA model
processes and browser tabs were closed. The installed app remains running.
