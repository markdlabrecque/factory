<!-- Throwaway decision record for #70's Board design lab, #71's browser fixes and #72's black and chrome Orbital finish and #73's reflective ring bands. Records host Chromium observations separately from Factory verdicts. Prototype branch only; simulated data; no winner chosen yet. -->
# Board design prototype

Status: **Decision pending user comparison.** No design has been chosen.

- Issue: [#70 Compare three animated Factory Board designs](https://github.com/markdlabrecque/factory/issues/70)
- Source: [`board/board-prototype.html`](../board/board-prototype.html), one self-contained HTML file (inline CSS, SVG and JavaScript; no fetches, storage, CDN or build step)
- Prototype branch: `prototype/board-three-concepts`
- Ticket branch from this run: `70-compare-three-animated-factory-board-des` (cut from the prototype branch, not pushed by Factory)

## Question being tested

Which visual direction should a future Factory Board take when it shows ticket stages, activity and progress with futuristic, three-dimensional, moving machinery?

## Approved scope

Separate-branch demos with simulated progress and no live Board changes. `board.template.html`, `board.mts`, `board-server.mts`, the CLI and installed or copied workflows are unchanged. The prototype is never copied into projects or installed by Factory, and must never be merged into `main`.

## The three designs

- **A / Assembly**: dark petrol floor, mint edges, amber machinery. Isometric production floor with build, verify and deliver stations, moving conveyor treads and rollers, two articulated robot arms, a verification scanner gantry, a sliding delivery gate, weld sparks while building, pointer parallax and a CSS 3D crate for the selected ticket.
- **B / Orbital**: black and chrome finish (#72): polished black ground and disc, chrome rings whose top faces carry reflected light bands (#73), core, capsules and docking arm, chrome-white progress, and one hot red accent for the selection, verification sweep and kicker. Tilted CSS 3D station with three counter-rotating rings, a stacked core with turning vanes, glowing stage arcs, ticket capsules that travel between docks (capsules and dock labels are drawn flat above the 3D scene at their projected positions, so the rings never cut through their text), a radial verification sweep, a telescoping docking arm, two drones and a segmented radial progress gauge.
- **C / Megastructure**: graphite, hot orange and brass. Vertical factory cutaway with perspective floors, an intake, a build press, a verify scan cage, a delivery hatch and a dispatch deck, a gantry crane trolley, shaft gears, a service fan, conduits that light up with progress, a CSS 3D cargo lift, a stage spine and a vertical dispatch meter.

## Shared controls

- Bottom switcher with previous/next and A/B/C choices; `?variant=A|B|C` (invalid falls back to A), History API back/forward, reload, and left/right arrow keys.
- `DESIGN PROTOTYPE` and `SIMULATED DATA` markers; a collapsible **Demo state** inspector with the full simulation record.
- Six fictional tickets, DEMO-241 to DEMO-246, across queued, implementing, verifying, delivering, done and blocked. One deterministic clock advances them each second over a 64-second labelled loop; the blocked ticket never advances.
- **Pause demo / Resume demo** (stops all CSS motion and progress; in-flight glides freeze where they are and resume on Resume, while a change made during the pause, such as Restart, jumps to its end), **Restart demo**, 1x/2x speed. Reduced motion starts paused until Resume; a hidden page suspends motion without a jump on return.

## Preview

```sh
npm run prototype:board
```

Open <http://127.0.0.1:4455/board-prototype.html?variant=A> (or `B`, `C`). The server binds to loopback and serves only `board/`.

## Verification split

Factory passed the initial artifact and runtime-contract checks at `3b720e7`, including seven Board tests. Host Chromium 155 review then confirmed animation, ticket selection, URL persistence, back/forward, reduced-motion opt-in and no JavaScript exceptions. It found blank orbital capsule faces, a widened mobile viewport and transitions that continued after Pause.

Factory implemented the fixes in [#71](https://github.com/markdlabrecque/factory/issues/71), commit `717a59a`. Its verifier kept an INCONCLUSIVE verdict because the container has no rendering engine. That verdict is retained, not rewritten as a browser pass.

The separate host review opened the updated page in Chromium at 1440x1000 and 390x844. All six orbital capsule labels now render. All three variants advance ticket progress, stop their animation timelines on Pause and resume afterward. Orbital stayed 390 pixels wide across 22 samples over 66 seconds. No JavaScript exceptions occurred. Screenshots and video are retained under the original checkout's `.sandcastle/evidence/71/host-browser/`.

The black and chrome Orbital finish (#72) is a palette change made after that review. A host Chromium review of #72 (commit `dd3ea2c`) observed the black background and chrome UI, readable capsule labels, working animation and Pause, and byte-identical Assembly and Megastructure baseline screenshots. It also found the three ring top faces, the largest chrome surfaces, still flat white.

At the user's request, [#73](https://github.com/markdlabrecque/factory/issues/73) gives each ring's top face a local diagonal gradient of bright highlights and dark reflected bands, which the existing ring rotations carry around. Factory checked this statically only (the container has no browser); the reflected bands have not yet been viewed in a host browser.

Exact paused screenshot equality was not used as a gate. Megastructure differed in ten antialiased glow pixels within a 2x10-pixel area despite stable animation timelines. Assembly and Orbital paused screenshots were byte-identical. This is exploratory review, not a permanent test suite. On narrow phones, some decorative dock labels are clipped or overlap; the readable ticket manifests remain available. These concepts are best compared on a desktop.

## Verdict

Decision pending user comparison.
