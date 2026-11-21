// Static admission through real selected entrypoints; tracker/Pi/engine boundaries are fixture-owned.
// No baseline execution or implementation authorization is established by these refusal journeys.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {fixture, assertUnchargedAdmission} from './refresh-fixture.mts';
import {prepareFixtureAcceptance} from './fixtures/acceptance-preparation.mts';
import {readStoredReadiness} from '../board/readiness.mts';

for (const kind of ['github','gitlab']) for (const family of ['openai','anthropic']) {
  for (const route of ['dispatch','direct','explicit-refresh','refreshProject','recovery']) {
    test(`${route} static denial matrix (${kind}/${family})`, t => {
      // One runtime per tracker/family/route; independent exact inputs isolate each fault without repairing evidence.
      const f=fixture(t,kind,false);
      const config=join(f.root,'.factory/factory.toml');
      writeFileSync(config,readFileSync(config,'utf8').replace('family = "anthropic"',`family = "${family}"`));
      writeFileSync(join(f.home,'bin/pi'),`#!${process.execPath}\nimport {appendFileSync} from 'node:fs'; appendFileSync(process.env.FAKE_STATE+'/forbidden-model',JSON.stringify(process.argv)+'\\n'); process.exit(91);\n`,{mode:0o755});
      writeFileSync(join(f.home,'bin/docker'),`#!${process.execPath}\nimport {capabilityDocker} from ${JSON.stringify(new URL('./fixtures/capability-docker.mjs',import.meta.url).pathname)}; const out=capabilityDocker(process.argv.slice(2),process.env.FAKE_STATE); if(out===undefined) process.exit(90); console.log(out);\n`,{mode:0o755});
      const prior=route.includes('refresh') || route==='refreshProject' ? f.record(7,'stopped') : undefined;
      for (const fault of ['missing','malformed','unapproved']) {
        f.data.tickets[0].description=`Model tier: mid\nFull child requirement: ${fault}`;
        f.data.parents[7]=20;
        f.data.notes[20]=[{body:'Approved parent decisions and ordered full-scope plan',system:false}];
        f.save();
        // Seed a CURRENT execution manifest to prove refusal cannot be bypassed through cached selection.
        if (route==='dispatch') f.manifest(7);
        const savedManifest=f.bytes(join(f.dir,'graph/owner_repo--7.json'));
        if(fault!=='missing') {
          const input=JSON.parse(execFileSync(f.node,['--input-type=module','-e',`const t=await import(${JSON.stringify(join(f.runtime.directory,'tracker.mts'))});const g=await import(${JSON.stringify(join(f.runtime.directory,'ticket-input.mts'))});process.stdout.write(JSON.stringify(g.freezeTicketInput(t.contextSource,7)));`],{cwd:f.root,env:f.env,encoding:'utf8',timeout:20_000}));
          const reference=prepareFixtureAcceptance(f.dir,input);
          const record=JSON.parse(readFileSync(reference,'utf8'));
          const original=join(f.dir,'acceptance',record.bundle.id,fault==='malformed'?'contract.json':'approval.json');
          chmodSync(original,0o600);
          writeFileSync(original,fault==='malformed'?'{':JSON.stringify({decision:'approve',semanticAdequacy:true}));
        }
        let argv:string[];
        if(route==='refreshProject') argv=['--input-type=module','-e',`
          const {context,effectiveConfig}=await import(${JSON.stringify(join(f.runtime.directory,'runtime-config.mts'))});
          const {projectLaunchReadiness}=await import(${JSON.stringify(join(f.runtime.directory,'launch-readiness.mts'))});
          const readiness=await projectLaunchReadiness({projectRoot:context.projectRoot,runtimeRoot:context.runtimeRoot,runtimeIdentity:context.manifest.id,runtimeDependencies:context.manifest.dependencies,config:effectiveConfig,stateRoot:process.env.SANDCASTLE_STATE_DIR,base:'main'});
          const {refreshProject}=await import(${JSON.stringify(join(f.runtime.directory,'refresh.mts'))});refreshProject({base:'main',ticket:'7',readiness});`];
        else if(route==='recovery') argv=[join(f.runtime.directory,'recovery-analysis.mts'),'7','main'];
        else if(route==='direct') argv=[join(f.runtime.directory,'main.mts'),'--base','main','--issue','7'];
        else argv=[join(f.runtime.directory,'dispatch.mts'),'--base','main',...(route==='explicit-refresh'?['--refresh-only','--ticket','7']:[])];
        const result=spawnSync(f.node,argv,{cwd:f.root,env:f.env,encoding:'utf8',timeout:20_000});
        assert.equal(result.signal,null,result.stdout+result.stderr);
        assert.equal(existsSync(join(f.fake,'forbidden-model')),false,`${fault}: zero analysis/auth invocations`);
        assert.equal(existsSync(join(f.fake,'models.log')),false,`${fault}: zero implementation invocations`);
        assert.equal(existsSync(join(f.fake,'launches')),false,`${fault}: no launched child`);
        assertUnchargedAdmission(f.dir);
        assert.equal(f.bytes(join(f.dir,'owner_repo--7.json')),prior??'absent',`${fault}: saved work/budgets unchanged; no stopped/queued run`);
        assert.equal(f.bytes(join(f.dir,'graph/owner_repo--7.json')),savedManifest,`${fault}: cached analysis preserved`);
        const stored=readStoredReadiness(f.dir,f.root);
        assert.ok('report' in stored,JSON.stringify(stored));
        const check=stored.report.checks.find(c=>c.id==='acceptance-static-7');
        assert.equal(check?.status,'blocked',result.stdout+result.stderr);
        assert.equal(check?.ticket,'7'); assert.equal(check?.nextActor,'operator');
        assert.match(check!.nextAction,/Preparer\/reviewer/);
        assert.match(check!.reason,fault==='missing'?/missing-preparation/:/custody-unavailable/);
        assert.deepEqual(readStoredReadiness(f.dir,f.root),stored,'passive reads do not renew or execute');
      }
    });
  }
}
