// Test harness: `factory tick` exactly as cli/bin/factory.mts runs it (production systemd adapter, SIGTERM/SIGINT cancel
// the tick), except that the repair command the launcher starts is RECOVERY_NPX, a test stand-in for
// `npx tsx .sandcastle/main.mts --recover`, so no real npx, tsx or agent runs. Jam confirmation (afterPass), settling and
// launching (recovery-run.mts) are the real ones; docker is whatever `docker` is first on PATH (the test's stub). Run it
// with the systemctl stub first on PATH; it never reaches a real service manager.
import { paths } from '../../src/paths.mts';
import { scheduleBackend } from '../../src/platform/scheduler.mts';
import { tick, tickExitCode } from '../../src/commands/tick.mts';
import { afterPass } from '../../src/jam-detect.mts';
import { launchRecovery } from '../../src/recovery-run.mts';
const p = paths();
const abort = new AbortController();
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => abort.abort());
const npx = process.env.RECOVERY_NPX!;
process.exitCode = tickExitCode(await tick(p, { backend: scheduleBackend(p), signal: abort.signal,
  recovery: (q, o) => afterPass(q, { ...o, launch: (r, x) => launchRecovery(r, { ...x, npx }) }) }));
