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
/** Assemble code separately from mutable project data, then publish the reviewed manifest. */
export function projectFixture(p: Paths, root: string) {
  installedFixture(p);
  const code=join(root,'.factory-workflow');
  // Once published, never restore a removed mandatory helper on a later review.
  if(!existsSync(join(code,'runtime-manifest.json'))) {
    const source=join(p.home,'workflow-source');
    if(!existsSync(source)) copyRuntimeSources(source);
    // Existing tests supply narrow executable stubs; fill other mandatory files once.
    for(const a of RUNTIME_ASSETS) {
      const target=join(code,a.destination);
      if(!existsSync(target) || ['package.json','package-lock.json'].includes(a.destination)) {
        // Scaffold fixtures may stage their initial executable stubs beside project data.
        // Only inventory assets cross this boundary, never config, logs or arbitrary helpers.
        const staged=join(root,'.sandcastle',a.destination);
        const from=existsSync(staged) && !['package.json','package-lock.json'].includes(a.destination)
          ? staged : join(source,a.source);
        mkdirSync(dirname(target),{recursive:true});cpSync(from,target);
      }
    }
    if(!existsSync(join(code,'node_modules'))) installPackages(code);
  }
  const config=join(root,'.sandcastle','factory.toml');
  let text=readFileSync(config,'utf8');
  if(!/^\[workflow\]/m.test(text)) text+='\n[workflow]\nmode = "project"\ndirectory = ".factory-workflow"\n';
  writeFileSync(config,text);
  refreshManifest(root);
}
export function refreshManifest(root: string) {
  const code=join(root,'.factory-workflow');
  writeFileSync(join(code,'runtime-manifest.json'),JSON.stringify(regenerateRuntimeManifest(code))+'\n');
}
