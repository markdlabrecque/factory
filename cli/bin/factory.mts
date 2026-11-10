#!/usr/bin/env node
// Factory CLI: install, diagnose, control the board, reverse the manifest, register projects and init them.
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
const USAGE = `factory install [--link]
factory doctor
factory board start|stop|status
factory uninstall [--dry-run] [--purge | --keep-state]
factory project add|ls|rm [path] [--json (ls)]
factory init [path] --profile personal|client --repo <namespace/project> --image <image> [--host <gitlab host> --project-id <n>]`;
const SCHEMAS: Record<string, Record<string, { type: 'boolean' | 'string' }>> = {
  install: { link: { type: 'boolean' } }, doctor: {}, board: {},
  uninstall: { 'dry-run': { type: 'boolean' }, purge: { type: 'boolean' }, 'keep-state': { type: 'boolean' } },
  project: { json: { type: 'boolean' } },
  init: { profile: { type: 'string' }, repo: { type: 'string' }, image: { type: 'string' }, host: { type: 'string' }, 'project-id': { type: 'string' } },
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
    } else if (command === 'project') {
      if (extra.length) throw new Error('Unexpected arguments');
      if (v.json && first !== 'ls') throw new Error('--json applies to project ls');
      await project(p, first, second, { json: v.json });
    } else {
      if (second || extra.length || (first && command !== 'board')) throw new Error('Unexpected arguments');
      if (v.purge && v['keep-state']) throw new Error('Choose --purge or --keep-state');
      if (command === 'install') await install(p, backend(p), { link: v.link });
      else if (command === 'doctor') process.exitCode = await doctor(p);
      else if (command === 'uninstall') await uninstall(p, backend(p), { dryRun: v['dry-run'], purge: v.purge });
      else if (command === 'board') await board(backend(p), first);
    }
  }
} catch (error) {
  console.error(`factory: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
