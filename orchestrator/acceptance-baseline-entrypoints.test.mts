// Admission seam: actual selected dispatcher and separately owned baseline engine, real disposable Git/state.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {fixture,git} from './refresh-fixture.mts';
import {readAdmission,readBaselineReservations} from '../board/admission.mts';
import {readStoredReadiness} from '../board/readiness.mts';
import {acceptanceHash} from './acceptance-contract.mts';
import {executionSnapshot} from '../cli/test/execution-fixture.mts';
import {spawnSync} from 'node:child_process';
import {claimRun} from '../board/board.mts';

for(const kind of ['github','gitlab'])for(const family of ['openai','anthropic']) {
  test(`${kind}/${family}: real dispatch claim/launch requires the current exact host execution grant`,t=>{
    const f=fixture(t,kind),config=join(f.root,'.factory/factory.toml');
    writeFileSync(config,readFileSync(config,'utf8').replace('family = "anthropic"',`family = "${family}"`));
    f.data.tickets[0].description='Model tier: mid\nStandalone requirement';f.save();
    Object.assign(f.snapshot,executionSnapshot({...f.runtime,env:f.env},f.root));f.manifest(7);f.baseline();
    const {root}=reference(f),grant=join(root,readdirSync(root).find(n=>n.startsWith('execution-authorization-'))!);
    const bytes=readFileSync(grant);rmSync(grant);
    const held=f.pass();
    assert.equal(existsSync(join(f.fake,'launches')),false,held.stdout+held.stderr);
    assert.deepEqual(readAdmission(f.dir).claims,{});assert.deepEqual(readAdmission(f.dir).generations,{});
    writeFileSync(grant,bytes,{mode:0o600,flag:'wx'}); // explicit fixture host restores its same unexpired grant, not a launch writer.
    const allowed=f.pass();
    assert.match(f.bytes(join(f.fake,'launches')),/--issue 7/,allowed.stdout+allowed.stderr);
    assert.ok(JSON.parse(f.bytes(join(f.dir,'owner_repo--7.json'))).claim);
  });
}

function reference(f:ReturnType<typeof fixture>) {
  const root=join(f.dir,'acceptance'), name=readdirSync(root).find(n=>n.startsWith('baseline-current-'))!;
  const path=join(root,name); return {root,path,record:JSON.parse(readFileSync(path,'utf8'))};
}

test('dispatch requires a separately authorized owned baseline before real implementation claim and launch', t => {
  const f = fixture(t);
  f.data.tickets[0].description='Model tier: mid\nStandalone requirement'; f.save(); f.manifest(7);
  const result=f.pass();
  assert.equal(existsSync(join(f.fake,'launches')),false,'no implementation child before authorized baseline');
  assert.equal(existsSync(join(f.dir,'owner_repo--7.json')),false,'no implementation claim-created run');
  const admission=readAdmission(f.dir);
  assert.deepEqual(admission.claims,{}); assert.deepEqual(admission.generations,{}); assert.deepEqual(admission.recovery,{});
  const stored=readStoredReadiness(f.dir,f.root);
  assert.ok('report' in stored,result.stdout+result.stderr);
  assert.equal(stored.report.checks.find(c=>c.id==='acceptance-baseline-7')?.reason,'Acceptance baseline: preparation-required');
});

test('authentic current authorized owned baseline permits the actual dispatch claim and implementation child', t => {
  const f=fixture(t); f.data.tickets[0].description='Model tier: mid\nStandalone requirement'; f.save(); f.manifest(7);
  f.baseline();
  assert.deepEqual(readBaselineReservations(f.dir),[],'baseline cleanup completed independently');
  assert.deepEqual(readAdmission(f.dir).claims,{},'baseline never takes implementation claim');
  const result=f.pass();
  assert.match(f.bytes(join(f.fake,'launches')),/--issue 7/,result.stdout+result.stderr);
  const run=JSON.parse(readFileSync(join(f.dir,'owner_repo--7.json'),'utf8'));
  assert.ok(run.claim,'actual implementation claim created only after baseline');
  assert.ok(readAdmission(f.dir).generations['owner/repo']>0);
});

for (const fault of ['missing','stale-sha','current-sha','changed-ticket','changed-config','changed-reset','revoked-grant','expired-grant','unknown','already-green','mismatch','cancelled','cleanup-uncertain','tampered-output']) {
  test(`dispatch denies ${fault} baseline before claim/child and passive observation preserves ownership`, t => {
    const f=fixture(t); f.data.tickets[0].description='Model tier: mid\nStandalone requirement'; f.save(); f.manifest(7);
    f.baseline(7,['unknown','already-green','mismatch','cancelled','cleanup-uncertain'].includes(fault)?fault:'');
    const {root,path,record}=reference(f);
    const grantName=readdirSync(root).find(n=>n.startsWith('execution-authorization-'))!, grantPath=join(root,grantName);
    if(fault==='missing')rmSync(path);
    if(fault==='stale-sha') { record.binding.sha='0'.repeat(40); chmodSync(path,0o600); writeFileSync(path,JSON.stringify(record)); }
    if(fault==='current-sha') {git(f.root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','New current integration base');git(f.root,'push','-q','origin','main');}
    if(fault==='changed-reset') {const p=join(root,readdirSync(root).find(n=>n.startsWith('baseline-plan-'))!);const plan=JSON.parse(readFileSync(p,'utf8'));plan.request.reset.recipe+=' Changed reset';writeFileSync(p,JSON.stringify(plan));}
    if(fault==='changed-ticket') { f.data.tickets[0].description+='\nChanged requirement'; f.save(); }
    if(fault==='changed-config') { const p=join(f.root,'.factory/factory.toml');writeFileSync(p,readFileSync(p,'utf8')+'\n# changed exact configuration\n'); }
    if(fault==='revoked-grant')rmSync(grantPath);
    if(fault==='expired-grant') {const grant=JSON.parse(readFileSync(grantPath,'utf8'));grant.expiresAt=1;writeFileSync(grantPath,JSON.stringify(grant));}
    if(fault==='tampered-output') {const output=join(record.handle.directory,'sandbox-output.json');chmodSync(output,0o600);writeFileSync(output,'{}');}
    const before=readAdmission(f.dir), reservations=readBaselineReservations(f.dir);
    const result=f.pass();
    assert.equal(existsSync(join(f.fake,'launches')),false,result.stdout+result.stderr);
    assert.equal(existsSync(join(f.dir,'owner_repo--7.json')),false,'no implementation claim-created run');
    const after=readAdmission(f.dir);
    assert.deepEqual(after.claims,before.claims);assert.deepEqual(after.generations,before.generations);assert.deepEqual(after.recovery,before.recovery);
    assert.deepEqual(readBaselineReservations(f.dir),reservations,'unknown/cancel cleanup ownership is never guessed away');
    const stored=readStoredReadiness(f.dir,f.root);assert.ok('report' in stored,result.stdout+result.stderr);
    const check=stored.report.checks.find(c=>c.id==='acceptance-baseline-7');
    assert.equal(check?.status,'blocked');assert.equal(check?.nextActor,'operator');assert.match(check?.nextAction??'',/Preserve work, budgets and cleanup ownership/);
    const expected:Record<string,string>={'missing':'preparation-required','stale-sha':'changed-input','current-sha':'changed-input','changed-reset':'changed-input','changed-ticket':'preparation-required','changed-config':'changed-input','revoked-grant':'authorization-unavailable','expired-grant':'authorization-unavailable','unknown':'infrastructure','already-green':'review-required','mismatch':'behavior-mismatch','cancelled':'cancelled','cleanup-uncertain':'cleanup-pending','tampered-output':'cleanup-pending'};
    assert.equal(check?.reason,`Acceptance baseline: ${expected[fault]}`,result.stdout+result.stderr);
    const files=readdirSync(root).sort(), saved=acceptanceHash(files.map(n=>[n,readFileSyncSafe(join(root,n))]));
    assert.deepEqual(readStoredReadiness(f.dir,f.root),stored);
    assert.equal(acceptanceHash(readdirSync(root).sort().map(n=>[n,readFileSyncSafe(join(root,n))])),saved,'passive reads do not run preparation or rotate records');
    assert.deepEqual(readBaselineReservations(f.dir),reservations);
  });
}
test('dispatch discards an authentic baseline when original preparation is revoked during the final image read', t => {
  const f=fixture(t);f.data.tickets[0].description='Model tier: mid\nStandalone requirement';f.save();f.manifest(7);f.baseline();
  const {root,record}=reference(f), prepared=join(root,`prepared-${record.binding.ticket.contentHash}.json`);
  writeFileSync(join(f.home,'bin/docker'), `#!${process.execPath}\nimport {existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {capabilityDocker} from ${JSON.stringify(new URL('./fixtures/capability-docker.mjs',import.meta.url).pathname)};const a=process.argv.slice(2),p=process.env.FAKE_STATE+'/image-reads';if(a[0]==='image'){const n=existsSync(p)?Number(readFileSync(p,'utf8'))+1:1;writeFileSync(p,String(n));if(n===2)rmSync(${JSON.stringify(prepared)});}const out=capabilityDocker(a,process.env.FAKE_STATE);if(out===undefined)process.exit(90);console.log(out);\n`,{mode:0o755});
  const result=f.pass();
  assert.equal(existsSync(join(f.fake,'launches')),false,'no child after final I/O revocation: '+result.stdout+result.stderr);
  assert.equal(existsSync(join(f.dir,'owner_repo--7.json')),false,'no implementation claim after revocation');
});
for (const route of ['direct','adopted']) test(`${route} main refuses missing or revoked baseline before acquiring/adopting ownership`, t => {
  const f=fixture(t); f.data.tickets[0].description='Model tier: mid\nStandalone requirement';f.save();
  writeFileSync(join(f.home,'bin/docker'), `#!${process.execPath}\nimport {capabilityDocker} from ${JSON.stringify(new URL('./fixtures/capability-docker.mjs',import.meta.url).pathname)};const out=capabilityDocker(process.argv.slice(2),process.env.FAKE_STATE);if(out===undefined)process.exit(90);console.log(out);\n`,{mode:0o755});
  if(route==='adopted') f.baseline();
  if(route==='adopted') {const {root}=reference(f);rmSync(join(root,readdirSync(root).find(n=>n.startsWith('execution-authorization-'))!));}
  const claim=route==='adopted'?claimRun({dir:f.dir,project:'owner/repo',iid:'7',pid:process.pid,cap:2,patch:{base:'main',note:'pending saved work'}}):undefined;
  if(claim)assert.ok(claim.ok);
  const file=join(f.dir,'owner_repo--7.json'),before=f.bytes(file),admission=readAdmission(f.dir);
  const result=spawnSync(f.node,[join(f.runtime.directory,'main.mts'),'--issue','7','--base','main'],{cwd:f.root,env:{...f.env,...(claim?.ok?{FACTORY_LAUNCH_CLAIM:claim.run.claim}:{})},encoding:'utf8',timeout:20000});
  assert.match(result.stderr,/Acceptance baseline hold:/,result.stdout+result.stderr);
  assert.equal(f.bytes(file),before,'denial preserves pending work byte-for-byte');
  assert.deepEqual(readAdmission(f.dir),admission,'no claim, adoption, generation or charge');
  assert.equal(existsSync(join(f.fake,'models.log')),false);
});
function readFileSyncSafe(path:string) {try{return readFileSync(path,'utf8');}catch{return 'directory';}}
