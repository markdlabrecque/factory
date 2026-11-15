// Standalone Board shares Factory's bundle builder and ownership protocol, not a copied project workflow.
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { assertRuntimeAvailable, recoverRuntimePreparations, reserveRuntimePreparation, withRuntimeLock, withRuntimeTransaction, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
const [source, dataArgument] = process.argv.slice(2);
if (!source || !dataArgument) throw Error('Expected source and standalone runtime data directory');
const data = resolve(dataArgument);
const p = { data, runtimes: join(data, 'runtimes'), runtimeDescriptor: join(data, 'runtime.json') } as any;
await withRuntimeTransaction(p, async () => withRuntimeLock(p, () => {
  assertRuntimeAvailable(p);
  // Recovery itself validates ownership; a new store has nothing to recover.
  try { realpathSync(p.runtimes); recoverRuntimePreparations(p); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const bundle = prepareRuntimeBundle({ sourceRoot: realpathSync(source), runtimeStore: p.runtimes, beforePrepare: plan => reserveRuntimePreparation(p, plan) });
  writeRuntimeDescriptor(p, bundle.id);
}));
