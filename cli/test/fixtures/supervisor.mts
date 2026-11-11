// Test harness: the real macOS supervisor (superviseProcess, as `factory supervise` runs it) with the production launchd
// adapter, but a short first delay (FIRST_MS) so a test can hold a real supervisor process mid-tick. Run it with the
// launchctl stub first on PATH; it never reaches a real launchd.
import { paths } from '../../src/paths.mts';
import { LaunchdSchedule } from '../../src/platform/scheduler-launchd.mts';
import { superviseProcess } from '../../src/commands/supervise.mts';
const p = paths();
process.exitCode = await superviseProcess(p, new LaunchdSchedule(p), { firstDelayMs: Number(process.env.FIRST_MS ?? 50), intervalMs: Number(process.env.INTERVAL_MS ?? 600_000) });
