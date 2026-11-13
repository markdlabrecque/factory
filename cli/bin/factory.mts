#!/usr/bin/env node
// Factory CLI: install (from the checkout it is run from, install.mts), diagnose, control the board, reverse the manifest, register projects, init them, run a
// dispatcher pass or one ticket for one project (the registered checkout you are in, or --project <name>), clear a
// failed run so the next pass retries it, show the board service, scheduler health and timings and every run's stage, show a run's or repair's log, show, reset or review a project's self-recovery (`recovery status|reset|review`), classify a project's
// .sandcastle copy against Factory's (`update --dry-run`: missing, outdated, edited, project-owned; writes nothing) and
// create the missing and replace the unmodified outdated files (`update --apply`; edited and project-owned files are kept), and
// switch the scheduler (and each project's opt-in) on or off, and list or retire install-dispatch.sh's legacy timers (`legacy status|retire`), and
// remove a project's merged, clean Factory branches and their Factory-owned worktrees (`clean`; remote branches untouched), and
// save a manual comment on a ticket in the ticket journal, then post it to the tracker (`ticket comment`, #99). `tick` and `supervise` are internal: `tick` is what the Linux
// scheduler service runs, `supervise` what the macOS scheduler agent runs (it runs the ticks itself).
// Each command parses only its own flags, so one command's flags never leak into another.
import { parseArgs } from 'node:util';
import { paths } from '../src/paths.mts';
import { backend } from '../src/platform/index.mts';
import { install } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { doctor } from '../src/commands/doctor.mts';
import { board } from '../src/commands/board.mts';
import { project } from '../src/commands/project.mts';
import { init } from '../src/commands/init.mts';
import { dispatch } from '../src/commands/dispatch.mts';
import { logs } from '../src/commands/logs.mts';
import { run } from '../src/commands/run.mts';
import { retry } from '../src/commands/retry.mts';
import { status } from '../src/commands/status.mts';
import { recovery } from '../src/commands/recovery.mts';
import { update } from '../src/commands/update.mts';
import { schedule } from '../src/commands/schedule.mts';
import { legacy } from '../src/commands/legacy.mts';
import { clean } from '../src/commands/clean.mts';
import { ticketCommand } from '../src/commands/ticket.mts';
import { tick, tickExitCode } from '../src/commands/tick.mts';
import { superviseProcess } from '../src/commands/supervise.mts';
import { scheduleBackend } from '../src/platform/scheduler.mts';
const USAGE = `factory install [--link]
factory doctor
factory board start|stop|status
factory uninstall [--dry-run] [--purge | --keep-state]
factory project add|ls|rm [path] [--json (ls)]
factory init [path] --profile personal|client --repo <namespace/project> --image <image> [--host <gitlab host> --project-id <n>]
factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]
factory run <ticket> [--project <name>]
factory retry <ticket> [--project <name>]
factory status [--json] [--project <name>]
factory logs [ticket] [-f] [--recovery] [--project <name>]
factory update --dry-run|--apply [--project <name|path>] [--json]
factory recovery status|reset|review [--project <name|path>] [--json (status)] [--confirm (review)]
factory schedule on|off|status [--project <name|path>] [--json (status)]
factory legacy status [--json] | factory legacy retire
factory clean [--dry-run] [--project <name|path>] [--json]
factory ticket comment <ticket> <text> [--project <name|path>]`;
const SCHEMAS: Record<string, Record<string, { type: 'boolean' | 'string'; short?: string }>> = {
  install: { link: { type: 'boolean' } }, doctor: {}, board: {},
  uninstall: { 'dry-run': { type: 'boolean' }, purge: { type: 'boolean' }, 'keep-state': { type: 'boolean' } },
  project: { json: { type: 'boolean' } },
  init: { profile: { type: 'string' }, repo: { type: 'string' }, image: { type: 'string' }, host: { type: 'string' }, 'project-id': { type: 'string' } },
  dispatch: { 'dry-run': { type: 'boolean' }, max: { type: 'string' }, 'whole-issues': { type: 'boolean' }, project: { type: 'string' } },
  run: { project: { type: 'string' } },
  retry: { project: { type: 'string' } },
  status: { json: { type: 'boolean' }, project: { type: 'string' } },
  logs: { follow: { type: 'boolean', short: 'f' }, recovery: { type: 'boolean' }, project: { type: 'string' } },
  update: { 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, json: { type: 'boolean' }, project: { type: 'string' } },
  recovery: { json: { type: 'boolean' }, confirm: { type: 'boolean' }, project: { type: 'string' } },
  schedule: { json: { type: 'boolean' }, project: { type: 'string' } },
  legacy: { json: { type: 'boolean' } },
  clean: { 'dry-run': { type: 'boolean' }, json: { type: 'boolean' }, project: { type: 'string' } },
  ticket: { project: { type: 'string' } },
  tick: {}, supervise: {},
};
try {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '-h' || command === '--help' || rest.includes('--help') || rest.includes('-h')) console.log(USAGE);
  else {
    if (!SCHEMAS[command]) throw new Error(`Unknown command: ${command}`);
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: SCHEMAS[command] });
    const v = values as Record<string, any>;
    const [first, second, ...extra] = positionals;
    const p = paths();
    if (command === 'init') {
      if (second || extra.length) throw new Error('Unexpected arguments');
      await init(p, first, v);
    } else if (command === 'logs') {
      if (second || extra.length) throw new Error('Unexpected arguments');
      await logs(p, first, { project: v.project, follow: v.follow, recovery: v.recovery });
    } else if (command === 'run') {
      if (second || extra.length) throw new Error('Unexpected arguments');
      process.exitCode = await run(p, first, { project: v.project });
    } else if (command === 'retry') {
      if (second || extra.length) throw new Error('Unexpected arguments');
      await retry(p, first, { project: v.project });
    } else if (command === 'status') {
      if (first) throw new Error('Unexpected arguments');
      await status(p, { status: () => backend(p).status() }, { project: v.project, json: v.json, schedule: scheduleBackend(p) });
    } else if (command === 'update') {
      if (first) throw new Error('Unexpected arguments (name a project with --project)');
      process.exitCode = update(p, { dryRun: v['dry-run'], apply: v.apply, json: v.json, project: v.project });
    } else if (command === 'recovery') {
      if (second || extra.length) throw new Error('Unexpected arguments (name a project with --project)');
      if (v.json && first !== 'status') throw new Error('--json applies to recovery status');
      if (v.confirm && first !== 'review') throw new Error('--confirm applies to recovery review');
      process.exitCode = await recovery(p, first, { project: v.project, json: v.json, confirm: v.confirm });
    } else if (command === 'project') {
      if (extra.length) throw new Error('Unexpected arguments');
      if (v.json && first !== 'ls') throw new Error('--json applies to project ls');
      await project(p, first, second, { json: v.json });
    } else if (command === 'schedule') {
      if (second || extra.length) throw new Error('Unexpected arguments (name a project with --project)');
      if (v.json && first !== 'status') throw new Error('--json applies to schedule status');
      process.exitCode = await schedule(p, scheduleBackend(p), first, { json: v.json, project: v.project });
    } else if (command === 'legacy') {
      if (second || extra.length) throw new Error('Unexpected arguments');
      process.exitCode = legacy(p, first, { json: v.json });
    } else if (command === 'clean') {
      if (first) throw new Error('Unexpected arguments (name a project with --project)');
      process.exitCode = clean(p, { dryRun: v['dry-run'], json: v.json, project: v.project });
    } else if (command === 'ticket') {
      process.exitCode = ticketCommand(p, first, second, extra, { project: v.project });
    } else if (command === 'tick') {
      // Internal: what factory-tick.service runs. SIGTERM (systemctl stop) and SIGINT cancel the tick and its dispatcher pass.
      if (first) throw new Error('Unexpected arguments');
      const abort = new AbortController();
      for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => abort.abort());
      process.exitCode = tickExitCode(await tick(p, { backend: scheduleBackend(p), signal: abort.signal }));
    } else if (command === 'supervise') {
      // Internal: what the com.factory.tick launch agent runs (macOS). SIGTERM (launchctl bootout) cancels and exits 0.
      if (first) throw new Error('Unexpected arguments');
      process.exitCode = await superviseProcess(p, scheduleBackend(p));
    } else if (command === 'dispatch') {
      if (first) throw new Error('Unexpected arguments');
      process.exitCode = await dispatch(p, { project: v.project, dryRun: v['dry-run'], max: v.max, wholeIssues: v['whole-issues'] });
    } else {
      if (second || extra.length || (first && command !== 'board')) throw new Error('Unexpected arguments');
      if (v.purge && v['keep-state']) throw new Error('Choose --purge or --keep-state');
      if (command === 'install') await install(p, backend(p), { link: v.link });
      else if (command === 'doctor') process.exitCode = await doctor(p, scheduleBackend(p));
      else if (command === 'uninstall') await uninstall(p, backend(p), { dryRun: v['dry-run'], purge: v.purge });
      else if (command === 'board') await board(backend(p), first);
    }
  }
} catch (error) {
  console.error(`factory: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
