<!-- Factory test policy: exercise our real code across a stubbed systemd boundary; real service-manager trials are optional deployment checks, not verification gates. -->
# Testing

## Run the tests

Requires Node 22.18+; CI uses Node 24. From the repository root:

```sh
node --test orchestrator/*.test.mts board/*.test.mts cli/test/*.test.mts
```

Automated tests use temporary homes, synthetic projects, fake clocks and stubbed external commands. They must not control real user services, contact trackers, run agents, build Docker images or fetch credentials.

`FACTORY_HOME` changes Factory's filesystem paths. It does **not** isolate `systemctl`, D-Bus or another service manager. Inject the fake backend or place test-owned command stubs first on the child process's PATH. Ensure unhandled calls cannot fall through to the host's service manager.

## Systemd is a trusted dependency

Systemd is a well-tested third-party component. Factory tests its integration with systemd, not systemd's implementation.

Exercise the real Factory CLI, production service adapter and generated unit files against a stubbed `systemctl` boundary. A unit test can inject a fake backend; an end-to-end contract test must also exercise the production adapter's actual command construction.

| Verify in Factory tests | Trust systemd to implement |
| --- | --- |
| Exact command arguments, unit identities and lifecycle ordering | Its service and timer engines |
| Generated unit syntax, quoting, executable paths and environment | Its documented unit-directive semantics |
| Timer directives for initial delay, completion-relative interval and missed-tick policy | Actual elapsed timer firing and rearming |
| Configured output destination | Journald storage and retrieval |
| Configured kill mode and start timeout | Cgroup membership and systemd's signal delivery |
| Factory's own spawn, signal and shutdown behavior | Systemd's internal process management |

For example, assert that Factory writes the required timer directives and does not disable the timer after a failed pass. Do not wait for a real systemd timer to prove its documented rearming behavior. A stub cannot prove that behavior either; the test proves Factory supplied the correct integration contract.

## Stubs must test the contract

A `systemctl` stub must:

- Record exact argument arrays and reject unexpected calls.
- Model the enabled, active, inactive and missing states that Factory reads. Timer enablement and service activity are separate states.
- Return the output shapes the production adapter consumes.
- Inject failures at relevant lifecycle steps, including partial installation and enablement.
- Keep all files and state in the test fixture.

An unconditional `exit 0` stub is insufficient. Keep the stub limited to the command contract; do not build a substitute systemd scheduler.

Verify Factory's registry, ownership manifest, generated files, status output and error handling alongside the calls. Include repeated enable/disable, repair, dry-run, uninstall and refusal to overwrite unowned files. Preserve unrelated files and services.

Use injected clocks to test Factory-owned delays and elapsed-time calculations. Use synthetic subprocesses to test that Factory's disable/removal logic does not itself kill an active pass or detached child, and that it starts no later work after disable. Inspect the unit's kill/timeout directives separately. Do not describe a stubbed test as proof of systemd's actual process handling.

## Verification verdicts

The same boundary applies to unit tests, end-to-end tests and agent verification:

- **PASS:** the evidence supports the ticket's Factory-owned behavior and integration contract.
- **FAIL:** observed Factory behavior violates that contract.
- **INCONCLUSIVE:** evidence needed to verify Factory-owned behavior is unavailable.

The absence of systemd, a user bus, journald, a cgroup setup or a real timer in the verification container does **not**, by itself, justify INCONCLUSIVE. A privileged image, systemd as PID 1 and access to the host's manager are not acceptance prerequisites.

Evidence must name the stubbed boundary, commands run, assertions made and any untested Factory behavior. Do not claim real timer or journal observations from stub output. Do not turn an earlier INCONCLUSIVE verdict into PASS without reviewing the tested revision against this boundary.

This policy does not waive tests of Factory's own scheduling, concurrency, ownership, failure recovery or process lifecycle. It does not excuse an unrelated missing prerequisite or silently extend the trusted boundary to other dependencies.

## Optional deployment smoke tests

A real systemd user-session trial can provide additional deployment confidence, but is not an automated verification or merge gate. Obtain operator approval before changing host services. Use an isolated synthetic project, exact unit names and a cleanup procedure that preserves unrelated services and running work.

Never expose the host's systemd or D-Bus control socket to an agent container merely to satisfy verification. No production access or credential retrieval is authorized by a test or smoke-test instruction.

## In this repository

The sentence above about Factory's disable/removal logic not killing an active pass is the general policy. Under the approved #30 and #33 contract, `schedule off`, uninstall and reinstall cancel the tick's own dispatcher process group. The tests here prove two things about that: the cancellation is confined to that group, and independently detached ticket runs survive it.

- `cli/test/stubs/systemctl` is the stateful, failure-injecting `systemctl` stub. `cli/test/schedule-helpers.mts` puts it first on a test's PATH, exposes its call log and states, and injects failures (`fail('--user stop factory-tick.service')`). Its `calls.jsonl` also records any rejected call, and tests assert that list is empty.
- `cli/test/schedule-linux.test.mts` runs the real CLI and the production adapter (`cli/src/platform/scheduler-systemd.mts`) against that stub, and cancels synthetic process trees: a dispatcher holding a nested shell, a nested analysis process with its own child, and one detached ticket run in its own group. Where it sends the tick SIGTERM itself, it stands in for what `systemctl stop` is documented to do under `KillMode=process`.
- `cli/test/scheduler.test.mts` covers the same logic against the in-memory `FakeSchedule` (`cli/src/platform/fake.mts`).
- The tick and its cancellation are Factory code, so they are tested with real processes: `cli/src/commands/tick.mts`, `cli/src/tick-lock.mts`, `cli/src/tick-cancel.mts`.
