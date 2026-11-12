<!-- Branch-only design record: one functional dot tracker per unfinished ticket, vertically centered connectors through the current stage,
     solid green healthy/red unhealthy current dots with soft halos and clock-driven outward sonar pulses,
     filtered queue blockers, one latest-ten Shipped section and interval-based stats with system/light/dark themes.
     Implemented directly after human design review, without Factory. The approved design now also powers
     board.template.html, with persisted visits in board.mts and regression coverage in board.test.mts.
     Stats return focus to the invoking control. This source change does not deploy files or restart installed services. -->
# Board design prototype

Status: the approved tracker design replaces Assembly and Megastructure. At the user's request, it now also powers the real Board template.

- Source: [`board/board-prototype.html`](../board/board-prototype.html), one self-contained HTML file with inline CSS and JavaScript.
- Model regression tests: [`board/board-prototype.test.mjs`](../board/board-prototype.test.mjs), using Node's built-in test runner.
- Branch: `prototype/board-three-concepts`.
- No fetches, storage, CDN or build step. This is a throwaway visual prototype, never a scaffold or install input.

## Accepted design

The user accepted replacing both prior concepts and using one Shipped section for the entire Board view, not one per project. Their follow-up changed the connector rule: the bright line reaches the current stage, rather than stopping at the last completed stage. This work was explicitly approved for direct implementation without Factory.

Each active, blocked or queued ticket has its own selectable tracker. The stages are Queue, Setup, Build, Verify, Deliver and Shipped. Completed stages have filled dots. The current stage has a solid dot with a soft halo, matching the user's supplied reference. It is green for a healthy state and red for a blocked, jammed, failed, stopped or error state; future stages have outline dots. Bright connectors join every stage through the current one. The line is vertically centered on the dots. Dots and lines share size variables and border-box geometry, including pseudo-elements, so dot borders do not offset the line. Each current dot emits one sonar wave every 1.8 demo seconds. The wave expands from the center to beyond the dot and fades out in the same green or red color. Completed and future dots have no pulse. Text names the status and current stage, and blocked tickets also name the hold reason.

Queue rows show every current non-capacity blocker. They show "Docket is full" only when capacity is the only blocker. Reasons use codes rather than text matching, and duplicates are removed. Missing reason data says "Queue reason unavailable" rather than implying that capacity is full. Ticket details use the same display rule. The raw reason list remains in the fixture; this rule does not change admission.

One collapsible **Shipped** section sits below all unfinished tickets. It starts collapsed and contains at most ten rows, sorted by completion time descending, with the ticket ID as a stable tie-breaker. The count is the number of displayed rows, not all historical completions. New completions leave their unfinished section and enter the top of Shipped without opening it. The display limit does not delete history.

## Ticket stats

Click, Enter or Space opens a ticket's stats in a side dialog on desktop or a full-width dialog on narrow screens. Close or Escape returns focus to the ticket. If it is no longer visible, focus returns to the Shipped summary. Completion updates do not discard the selected ticket's stats.

The dialog shows:

- Running time, total elapsed time, queued time and blocked time.
- Running time per stage, summed across all visits, with repeated visit counts.
- Current blockers and historical reason episodes with durations and timestamps.
- Bounce count and each bounce's stage change, time and reason.

The demo record partitions time into queued, running and blocked intervals. Running time excludes queue and hold intervals. Total elapsed includes all three and freezes at completion. A hold does not add a stage visit. Concurrent blocker reasons can share a duration, so their individual durations must not be added. A bounce moves the current dot back and clears later completion marks, while retaining earlier visits for stats. All displayed measurements are simulated, not estimates or live telemetry.

## Appearance and demo controls

System, Light and Dark use the same layout and controls. System follows the OS preference live; the choice lasts for the page session. Thin borders, flat panels, monospace IDs and cyan stage marks replace the factory illustrations. Solid green current dots mark healthy states; solid red current dots mark bad states. Both have a soft halo instead of a fixed outer ring. Amber still marks hold labels and queue reasons. Status labels and stage shapes remain usable without color.

Seven unfinished fixtures and twelve prior completions exercise capacity-only queues, several simultaneous blockers, scheduled admission, an active hold, a verification bounce and the ten-row history limit. DEMO-243 waits for DEMO-241 and approval until T+00:50, then shows capacity alone until admission at T+00:58. The active hold remains blocked throughout the loop.

One deterministic clock loops every 120 seconds. Pause freezes the clock and sonar waves. The waves use the same clock, so row updates do not restart them; speed, seeking and restart also apply to the pulse. Restart restores time zero and loop one without changing the pause state. The slider pauses the demo and seeks to a second from 0 to 119. Speed choices are 1× and 2×. Reduced motion starts paused, and enabling it pauses a running demo. Reduced motion hides the sonar waves even if the user resumes the demo; the solid stage dots and static halos remain visible. Hidden pages suspend time without catching up on return. Theme and detail controls do not restart the clock.

## Preview

```sh
npm run prototype:board
```

Open <http://127.0.0.1:4455/board-prototype.html>. The server binds to loopback and serves only `board/`. Opening the HTML file directly also works. Old `?variant=A|C` links now open the single tracker design.

## Verification

Run the retained model tests without installing dependencies:

```sh
node --test board/board-prototype.test.mjs
```

Seven tests pass. They cover the sonar wave's expansion, fade and repeat, one pulse per current dot and no pulse for shipped tickets, reason filtering and deduplication, missing reasons, connectors through active and blocked stages, queue admission, bounce resets and retained visits, time partitioning across every fixture at every second, frozen completed totals and holds that do not count as running time.

A host Chromium/Playwright pass also checked:

- Initial active, blocked and queued rows, and twelve prior completions limited to ten displayed rows.
- Completion moving a ticket into the first Shipped row, without opening the section.
- Collapsing and expanding Shipped, selecting ticket stats and retaining the ten-row limit after updates.
- Queue reason changes, admission, blocked work and the verification bounce.
- Keyboard selection, Escape and focus restoration.
- Pause/resume, restart while paused, speed changes and loop reset.
- Explicit Light/Dark selection and live System theme changes.
- Dot and connector vertical centers match in computed geometry, including the dot borders.
- Sonar waves stay centered on current dots, expand beyond them, inherit green/red in both themes, freeze on Pause and resume with the demo. Reduced motion hides them even after Resume.
- Healthy current dots are solid green and blocked dots are solid red in both themes, with matching soft halos and no fixed outer ring. Injected jammed, failed, stopped and error style states also use red; these are style checks, not new simulated runtime behaviors.
- Desktop at 1440 pixels and mobile at 390 pixels, including stats, with no horizontal page overflow.

Desktop dark, desktop light, ticket stats and mobile screenshots were inspected. No JavaScript page errors occurred. Browser checks and screenshots are local review artifacts, not a new dependency or a supported live-board test suite. No tests were retired.

## Promotion to the Board template

The user approved producing this design as `board/board.template.html`, directly without Factory. The prototype remains a separate simulated-data preview. No installed service was restarted and no project scaffold was copied as part of this source change. Existing unrelated edits, including AGENTS.md, remain intact.

The real template uses the existing stage sequence: Queue, Setup, Build, Verify, Post, Push, CI and Shipped. Each unfinished ticket has centered connectors through its current dot, a green working or red blocked/stopped/quiet dot, a soft halo and a sonar wave. Reduced motion hides waves, and hidden tabs pause them. Text still names each status. Unknown legacy stages are explicit rather than assigned a false current step.

Blocked and stopped runs stay in In progress; only `done` records enter Shipped. Shipped starts collapsed, sits at the bottom, and selects the ten latest completions after status/project filtering. Ties use the run key. Summary and filter counts remain Board-wide; the section count is the displayed count. Open ticket stats remain available through completion or removal from the visible ten. Close or Escape returns focus to the invoking title or View stats button; a blank-card click uses the title. Removed or hidden controls fall back to the Shipped summary.

Live records do not all contain full historical measurements. `board.mts` now persists `stageHistory` visits with stage, timestamp and recorded blocker reasons, plus `historyComplete`. Stage changes, launch claims, detected crashes and parked-reason changes create visits; heartbeats do not. Resuming stopped work keeps prior visits. Reopening a completed ticket starts a new lifecycle. History is bounded at 1,000 visits, with truncation marked incomplete. Old records retain their known current-stage start, but their history remains incomplete. If an older writer changes a stage without extending history, the writer/page also mark that history incomplete. New writers must be copied alongside the template to collect future measurements; the page cannot reconstruct earlier visits.

The stats dialog sums recorded running stages across repeated visits, excludes queue/hold intervals, names blocker episodes and counts backward stage transitions as bounces. A hold within one stage does not create an extra stage visit. Finished or stopped elapsed time freezes at its recorded terminal timestamp. Incomplete records explicitly show Unavailable for full running/queued/blocked totals and unknown stage measurements; known current-stage time remains visible as recorded time. The page does not invent bounce reasons or historical blockers.

Queue rows use optional structured `queueReasons`, with the existing writer's `note` as a fallback. Capacity has the label "Docket is full" only when it is the sole recorded blocker. The existing "waiting for a free slot" note maps to that capacity reason. Multiple supplied reasons are deduplicated and displayed together; reasons that a writer never recorded cannot be recovered. Admission and scheduler decisions are unchanged.

The existing JSON endpoint, ten-second polling, last-good-data behavior, project/status filters, safe links, activity text, appearance storage, keyboard access, local snapshots and evidence previews remain. Evidence pages never start a poller. Local snapshot stats use the embedded generation time rather than adding work time since the file was saved. Details use text nodes, including blocker reasons, titles and notes. Source changes are limited to the Board writer, template, tests and their documentation.

### Promotion verification

```sh
node --test board/board.test.mts board/board-prototype.test.mjs
```

All 18 tests pass. After merging current main, the full suite including the prototype passes: `node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts board/board-prototype.test.mjs` reports 213 passing tests. The merge retains main's token-fenced admission and recovery ownership; its claimed-run construction also records stage visits. No tests were retired. Eleven live-Board tests cover appearance, grouping, latest-ten selection after filtering, queue reasons, tracker stage recovery, invoking-control focus and its fallback, history persistence and bounds, real/legacy stats, time calculations, bounces, poller behavior, API/evidence safety, activity, launch reservations, crash history and atomic claims. The seven prototype tests still pass.

A Chromium pass against the actual Board server with temporary synthetic state checked working/blocked/quiet dots, multiple queue reasons, the ten-ticket limit, completion moving a ticket to the top while stats stay open, filtering before the limit, collapse state, keyboard selection and focus restoration, explicit legacy gaps, offline recovery, theme changes, a 390-pixel layout without overflow, evidence text safety without polling, and a local file snapshot. Desktop, mobile and stats screenshots were inspected. No page errors occurred. These checks used only temporary local state, not installed services or production data.
