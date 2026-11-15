// Explicit complete project overrides and installed descriptors in disposable test roots only.
// Package installation is a local fixture function; no registry or installed app is used.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { record } from '../src/manifest.mts';
import type { Paths } from '../src/paths.mts';
import { RUNTIME_ASSETS } from '../src/runtime-assets.mts';
import { prepareRuntimeBundle, regenerateRuntimeManifest } from '../src/runtime-bundle.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../src/runtime-ownership.mts';
import { copyRuntimeSources, installPackages } from './runtime-fixture.mts';
export function installedFixture(p: Paths) {
  if (existsSync(p.runtimeDescriptor)) return;
  const source = join(p.home, 'workflow-source'); copyRuntimeSources(source);
  const bundle = prepareRuntimeBundle({sourceRoot:source,runtimeStore:p.runtimes,install:installPackages});
  withRuntimeLock(p,()=>{recordRuntimeOwnership(p,bundle.id);writeRuntimeDescriptor(p,bundle.id);});
  record(p,{kind:'dir',path:p.runtimes}); record(p,{kind:'file',path:p.runtimeDescriptor});
}
/** Complete the intentionally stubbed workflow and explicitly publish its reviewed manifest. */
export function projectFixture(p: Paths, root: string) {
  installedFixture(p);
  const sc=join(root,'.sandcastle');
  const source=join(p.home,'workflow-source');
  if(!existsSync(source)) copyRuntimeSources(source);
  // Existing tests supply narrow executable stubs; fill every other mandatory file from source.
  for(const a of RUNTIME_ASSETS) {
    const target=join(sc,a.destination);
    if(!existsSync(target) || ['package.json','package-lock.json'].includes(a.destination)) {
      mkdirSync(dirname(target),{recursive:true});cpSync(join(source,a.source),target);
    }
  }
  if(!existsSync(join(sc,'node_modules'))) installPackages(sc);
  const config=join(sc,'factory.toml');
  let text=readFileSync(config,'utf8');
  if(!/^\[workflow\]/m.test(text)) text+='\n[workflow]\nmode = "project"\ndirectory = ".sandcastle"\n';
  writeFileSync(config,text);
  refreshManifest(root);
}
export function refreshManifest(root: string) {
  const sc=join(root,'.sandcastle');
  writeFileSync(join(sc,'runtime-manifest.json'),JSON.stringify(regenerateRuntimeManifest(sc))+'\n');
}
