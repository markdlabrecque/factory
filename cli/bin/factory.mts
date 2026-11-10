#!/usr/bin/env node
// First slice CLI: install, diagnose, control the board and reverse the manifest.
import { parseArgs } from 'node:util';
import { paths } from '../src/paths.mts';
import { backend } from '../src/platform/index.mts';
import { install } from '../src/commands/install.mts';
import { uninstall } from '../src/commands/uninstall.mts';
import { doctor } from '../src/commands/doctor.mts';
import { board } from '../src/commands/board.mts';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    link: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, purge: { type: 'boolean' },
    'keep-state': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const [command, action, ...extra] = positionals;
  if (values.help || !command) {
    console.log('factory install [--link]\nfactory doctor\nfactory board start|stop|status\nfactory uninstall [--dry-run] [--purge | --keep-state]');
  } else {
    if (extra.length || (action && command !== 'board')) throw new Error('Unexpected arguments');
    if (values.link && command !== 'install') throw new Error('--link requires install');
    if ((values['dry-run'] || values.purge || values['keep-state']) && command !== 'uninstall') throw new Error('Uninstall flags require uninstall');
    if (values.purge && values['keep-state']) throw new Error('Choose --purge or --keep-state');
    const p = paths();
    if (command === 'install') await install(p, backend(p), { link: values.link });
    else if (command === 'doctor') process.exitCode = await doctor(p);
    else if (command === 'uninstall') await uninstall(p, backend(p), { dryRun: values['dry-run'], purge: values.purge });
    else if (command === 'board') await board(backend(p), action);
    else throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`factory: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
