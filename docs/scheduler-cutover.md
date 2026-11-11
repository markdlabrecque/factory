<!-- Scheduler cutover runbook (#38): the one-time, by-hand move of one Linux machine from install-dispatch.sh's per-project
legacy timers to `factory schedule`. Factory never runs it: it reports legacy timers and stale copies, and the developer
removes the timers and refreshes each copy. Rehearsed against the systemctl stub by cli/test/cutover.test.mts. -->
# Scheduler cutover: one machine

This runbook moves one Linux machine from the legacy per-project timers to the single Factory scheduler. The legacy timers are the `sandcastle-dispatch@<name>.timer` units from `orchestrator/install-dispatch.sh`; the Factory scheduler is `factory schedule`. You run every step yourself. Factory does none of it automatically: it lists enabled legacy timers and refuses to opt in an outdated project copy, but it never disables a legacy timer or overwrites a project file. Steps 1 and 3 change nothing on the machine, so you can rehearse them at any time.

Run legacy timers and `factory schedule` at different times, never together. Both would run passes for the same projects. The run cap is shared, so this would not overfill it, but passes would double up and the turn order would be wrong.

macOS has no legacy timers, so skip step 2 there. The rest applies unchanged; the scheduler there is the `com.factory.tick` launch agent.

## Before you start

- This Factory checkout is up to date on `main`, and `factory install` has been run from it. Running it again over an existing install is safe: it refreshes the app and leaves the scheduler off.
- Each project's integration branch is checked out, pushed and fetched (`git fetch`). Scheduled passes use the branch a project has checked out when you opt it in, and Factory does not contact the remote to check it.
- `loginctl enable-linger $USER` has been run, so ticks keep running after you log out.
- Pick a quiet moment. Ticket runs that are already going keep going through every step, but no new pass starts between step 2 and step 5.

## 1. Inventory (changes nothing)

```sh
systemctl --user list-timers --all 'sandcastle-dispatch*'      # the legacy timers and their next pass
grep -H SANDCASTLE_REPO ~/.config/sandcastle/dispatch/*.env    # each timer's name and the checkout it runs
factory project ls                                             # registered projects and their schedule switch
factory schedule status                                        # lists enabled legacy timers with the exact disable command
```

Write down the exact timer names `schedule status` lists. Those are the only units step 2 touches. Also note any old single-project `sandcastle-dispatch.timer`. Register every checkout that a legacy env file names and the registry lacks: `factory project add <path>`. A new project starts with scheduling off.

## 2. Remove the legacy timers

For each name you wrote down:

```sh
<factory>/orchestrator/install-dispatch.sh --uninstall <name>   # systemctl --user disable --now sandcastle-dispatch@<name>.timer, then removes its .env
systemctl --user is-active sandcastle-dispatch@<name>.service   # a pass the timer had already started finishes on its own; wait for "inactive"
```

If an old single-project timer is installed, also run `systemctl --user disable --now sandcastle-dispatch.timer`.

Don't stop a running `sandcastle-dispatch@<name>.service`; let it finish. Ticket runs that the legacy passes launched are detached. They keep running, they still show on the board, and they still count against the cap.

Check: `systemctl --user list-timers --all 'sandcastle-dispatch*'` lists nothing, and `factory schedule status` no longer prints the legacy warning. The template unit files `sandcastle-dispatch@.service` and `@.timer` stay in `~/.config/systemd/user/`, which is harmless while no instance is enabled. Keep them if you might roll back. Retiring `install-dispatch.sh` is slice six.

## 3. Refresh each project's dispatcher copy

Do this for every project you will opt in. It must come after step 2, so that no legacy pass reads the files while you replace them. Follow the README's ["Updating a project's copy of the workflow"](../README.md#updating-a-projects-copy-of-the-workflow). In the project, on its integration branch:

1. Copy the unadapted files that `orchestrator/ADAPTING.md` ("Install into a project") lists, which must include `orchestrator/dispatch.mts` and `board/board.mts`. Merge changes into the files you adapted by hand: `config.mts`, `main.mts`'s `CONFIG`, `prompt.md`, `prompt.verify.md` and `sandbox/bootstrap-site.sh`.
2. Review the result with `git diff -- .sandcastle`.
3. From a terminal, run `.sandcastle/dispatch.sh --dry-run`. It checks logins, builds a missing image, and shows what a pass would start without launching anything. Scheduled passes run with no terminal and never build an image.
4. If the project tracks `.sandcastle/`, commit the refresh the way you normally change that project.

Factory never refreshes a copy for you. `factory update` is slice five.

## 4. Opt the projects in

```sh
factory schedule on --project <name>      # saves the branch checked out now
factory project ls                        # [scheduled: <branch>]
```

Factory refuses a project that is on a detached HEAD, a project whose branch `origin` lacks, a `dispatch.sh` that is missing or not executable, and a copy that still predates launch reservations ("predates launch reservations": go back to step 3). A refusal changes nothing. Opting in does not start the timer.

## 5. Arm the scheduler

```sh
factory schedule on                       # writes factory-tick.{service,timer}, then systemctl --user enable --now factory-tick.timer
factory schedule status                   # Scheduler: on; each opted-in project "ready"; no legacy warning
factory doctor                            # timer enabled and active, linger, no legacy dispatcher timers
journalctl --user -u factory-tick -f      # first tick about a minute later, then 5 minutes after each tick finishes
```

After the first tick, `factory status --project <name>` shows that project's last pass and its timings.

## Rolling back

```sh
factory schedule off                      # disables and stops the timer, cancels the current tick's pass; detached ticket runs keep going
<factory>/orchestrator/install-dispatch.sh <project root> [--name <name>]   # per project, re-enables its legacy timer
```

Opt-ins and saved branches stay in the registry, so a later `factory schedule on` resumes without opting in again. The refreshed copies also work with the legacy timers, which run the same `dispatch.sh`. Never leave both schedulers enabled.

## Rehearsal

`cli/test/cutover.test.mts` walks steps 1 to 5 and the rollback against the stateful `systemctl` stub (see [TESTING.md](../TESTING.md)), on a temporary home that starts like a machine still on `install-dispatch.sh`. Run it with `node --test cli/test/cutover.test.mts`. It shows that:

- `schedule status` lists the enabled legacy timer, with its disable command.
- An outdated copy is refused, and the refusal changes nothing.
- `install-dispatch.sh --uninstall <name>` removes only that timer's link and env file. Unrelated timers and the template units stay.
- The shipped `dispatch.mts` and `board.mts` satisfy the opt-in check.
- Opting in never arms the timer, and `schedule on` sends only `daemon-reload` and `enable --now factory-tick.timer`.
- Each opted-in project is `ready`, and one that was never opted in is not.
- `off` disables Factory's timer and keeps the opt-ins.

Throughout the test, Factory itself makes no call that names a legacy unit; the stub would reject one. The stub does not prove what systemd does on disable or stop. That is trusted, so the real cutover is still a step you run and check on the machine itself.
