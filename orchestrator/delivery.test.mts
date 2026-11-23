// #153: both adapters bind checks to exact heads; continuation has zero create/push/comment/rerun/draft effects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyTestRuntime, factoryToml } from '../cli/test/config-fixture.mts';
import type { DeliveryIdentity } from '../board/delivery.mts';
const dir = mkdtempSync(join(tmpdir(), 'factory-delivery-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
// Configure the immutable runtime snapshot before import instead of mutating live execution settings.
const moduleUrl = copyTestRuntime(join(dir, 'runtime'), factoryToml('owner/repo', { kind: 'gitlab', projectId: 42 }) + '\n[merge]\nauto = true\nrequired_checks = ["test"]\n');
const { TRACKER } = await import(moduleUrl('runtime-config.mts'));
const repo = TRACKER.project, host = (TRACKER as any).host ?? 'github.com', labHost = (TRACKER as any).gitlabHost ?? '', id = (TRACKER as any).projectId ?? 0;
const sha = 'a'.repeat(40);
const identities: Record<string, DeliveryIdentity> = {
  github: { kind: 'github', host, repository: repo, number: 1, url: `https://${host}/${repo}/pull/1`, branch: 'topic', base: 'main', sha },
  gitlab: { kind: 'gitlab', host: labHost, repository: repo, projectId: id, number: 1, url: `https://${labHost}/${repo}/-/merge_requests/1`, branch: 'topic', base: 'main', sha },
};
for (const tool of ['gh', 'glab']) writeFileSync(join(dir, tool), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), tool = ${JSON.stringify(tool)};
const path = ${JSON.stringify(join(dir, 'scenario'))};
const s = JSON.parse(fs.readFileSync(path, 'utf8'));
fs.appendFileSync(${JSON.stringify(join(dir, 'calls'))}, JSON.stringify([tool,...args])+'\\n');
const out = x => console.log(typeof x === 'string' ? x : JSON.stringify(x));
const sha = ${JSON.stringify(sha)}, repo = ${JSON.stringify(repo)};
const ghUrl = ${JSON.stringify(identities.github.url)}, glUrl = ${JSON.stringify(identities.gitlab.url)};
const mr = args.find(x => /merge_requests\\/1$/.test(x));
const pr = args.find(x => /pulls\\/1$/.test(x));
if (args[0] === 'pr' && args[1] === 'create') out(ghUrl);
else if (args[0] === 'pr' && args[1] === 'checks') out(s.checks ?? [{name:'test',bucket:'pass'}]);
else if (args[0] === 'pr' && args[1] === 'comment') out('');
else if (args.includes('POST') && args.some(x => x.endsWith('/merge_requests'))) out({iid:1,web_url:glUrl});
else if (args.some(x => /\\/merge$/.test(x))) {
  if (s.refuse) out(tool === 'gh' ? {merged:false} : {state:'opened'});
  else { s.merged = true; fs.writeFileSync(path, JSON.stringify(s)); if(s.lostResponse) process.exit(1); out(tool === 'gh' ? {merged:true} : {state:'merged'}); }
} else if (args.some(x => x.endsWith('/notes'))) out({});
else if (pr) {
  if(s.transport) process.exit(1);
  out({number:1,state:s.closed?'closed':'open',draft:s.draft??false,merged:s.merged??false,merged_at:s.merged?'2026-01-01T00:00:00Z':null,mergeable:true,mergeable_state:s.restricted?'blocked':'clean',
    head:{ref:'topic',sha:s.head??sha,repo:{full_name:repo}},base:{ref:s.base??'main',repo:{full_name:repo}}});
} else if (mr) {
  if(s.transport) process.exit(1);
  out({iid:1,project_id:${id},source_project_id:${id},target_project_id:${id},source_branch:'topic',target_branch:s.base??'main',sha:s.head??sha,state:s.merged?'merged':s.closed?'closed':'opened',draft:s.draft??false,merged_at:s.merged?'2026-01-01T00:00:00Z':null,detailed_merge_status:s.restricted?'not_approved':'mergeable',
    head_pipeline:s.noPipeline?null:{id:5,sha:s.pipelineSha??sha,status:s.status??'success'}});
} else if (args.some(x => x.includes('/check-runs'))) out([{check_runs:(s.checks??[{name:'test',bucket:'pass'}]).map(c=>({name:c.name,head_sha:s.checkHead??sha,status:c.bucket==='pending'?'in_progress':'completed',conclusion:c.bucket==='pass'?'success':c.bucket==='skipping'?'skipped':'failure'}))}]);
else if (args.some(x=>x.includes('/statuses'))) out([s.commitStatuses??[]]);
else if (args.some(x=>x.includes('/pipelines/5/jobs'))) out((s.jobs??[{name:'test',status:'success'}]).map(j=>({...j,commit:{id:s.jobHead??sha}})));
else process.exit(9);
`, { mode: 0o755 });
process.env.PATH = `${dir}:${process.env.PATH}`;
const github = await import(moduleUrl('tracker.github.mts')), gitlab = await import(moduleUrl('tracker.gitlab.mts'));
const setup = (s: object = {}) => { writeFileSync(join(dir, 'scenario'), JSON.stringify(s)); writeFileSync(join(dir, 'calls'), ''); };
const calls = (): string[][] => readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s));
const merges = () => calls().filter(a => a.some(x => x.endsWith('/merge')));
let now = Date.now(); Date.now = () => now;
globalThis.setTimeout = ((fn: () => void) => { now += 15000; fn(); return 0; }) as any;
const delivery = { beforeMerge: () => undefined, branch: 'topic', base: 'main', sha, title: 'title', body: (s: string) => s, onStage: () => {}, waitMinutes: 1, noCiMinutes: 0, autoMerge: true };
for (const [kind, adapter] of Object.entries({ github, gitlab })) {
  const identity = identities[kind];
  test(`${kind}: batch refs are never PR/MR publication or reconciliation authority`,async()=>{
    setup();for(const field of ['branch','base']){
      const d={...identity,[field]:'factory/batch/example'};
      await assert.rejects(adapter.deliver({...delivery,[field]:d[field]}),/batch ref/);
      assert.equal((await adapter.mergeExistingDelivery(d,()=>undefined)).state,'operator-required');
      assert.equal(adapter.observeDelivery(d).state,'operator-required');assert.equal(adapter.mergedInto(d.branch,d.base),false);assert.equal(adapter.mergedPr(1,d.branch,d.base),undefined);
    }assert.deepEqual(calls(),[]);
  });
  test(`${kind}: opened callback precedes CI and crash does not lose PR identity`, async () => {
    setup(); let captured: DeliveryIdentity | undefined;
    await assert.rejects(adapter.deliver({ ...delivery, onOpened: d => { captured = d; throw Error('crash after durable save'); } }), /crash after durable save/);
    assert.deepEqual(captured, identity); assert.equal(calls().length, 1);
  });
  test(`${kind}: initial exact-head success, required gates and mandatory authorization`, async () => {
    setup(); assert.equal((await adapter.deliver(delivery)).merged, true); assert.equal(merges().length, 1);
    assert.ok(merges()[0].includes(`sha=${sha}`));
    for (const beforeMerge of [() => 'requirements changed', () => { throw Error('unknown'); }, undefined]) {
      setup(); assert.equal((await adapter.deliver({ ...delivery, beforeMerge: beforeMerge as any })).merged, false); assert.equal(merges().length, 0);
    }
  });
  test(`${kind}: continuation pending then green merges once, no side effects`, async () => {
    setup(kind === 'github' ? { checks: [{name:'test',bucket:'pending'}] } : { status:'running', jobs:[{name:'test',status:'running'}] });
    assert.equal(adapter.observeDelivery(identity).state, 'ci-waiting');
    setup(); assert.equal((await adapter.mergeExistingDelivery(identity, () => undefined)).state, 'merged');
    assert.equal((await adapter.mergeExistingDelivery(identity, () => undefined)).state, 'merged');
    assert.equal(merges().length, 1);
    assert.ok(calls().every(a => a[1] === 'api' && !a.includes('POST') && !a.some(x => /notes|rerun/.test(x))));
  });
  test(`${kind}: changed identities, failed/skipped/missing checks and restrictions refuse merge`, async () => {
    const scenarios = [{head:'b'.repeat(40)}, {base:'other'}, {closed:true}, {draft:true}, {restricted:true},
      ...(kind === 'github' ? [{checks:[]}, {checks:[{name:'other',bucket:'pass'}]}, {checks:[{name:'test',bucket:'skipping'}]}, {checks:[{name:'test',bucket:'fail'}]}, {checkHead:'b'.repeat(40)}]
        : [{noPipeline:true}, {pipelineSha:'b'.repeat(40)}, {jobs:[]}, {jobs:[{name:'test',status:'skipped'}]}, {jobs:[{name:'test',status:'failed'}]}, {jobs:[{name:'test',status:'canceled'}]}])];
    for (const s of scenarios) { setup(s); const r = await adapter.mergeExistingDelivery(identity, () => undefined); assert.notEqual(r.state, 'merged', JSON.stringify(s)); assert.equal(merges().length, 0); }
  });
  test(`${kind}: lost merge response is reconciled on same PR, not blindly repeated`, async () => {
    setup({lostResponse:true}); await assert.rejects(adapter.mergeExistingDelivery(identity, () => undefined));
    assert.equal(adapter.observeDelivery(identity).state, 'merged'); assert.equal(merges().length, 1);
  });
}
test('GitHub legacy commit statuses are bound by exact-SHA endpoint and newest context result', async () => {
  setup({checks:[],commitStatuses:[{context:'test',state:'success'},{context:'test',state:'failure'}]});
  assert.equal(github.observeDelivery(identities.github).state,'ready');
  setup({checks:[],commitStatuses:[{context:'test',state:'success',sha:'b'.repeat(40)}]});
  assert.equal(github.observeDelivery(identities.github).state,'operator-required');
});
test('GitHub failed initial CI is an operator hold without draft mutation', async () => {
  setup({checks:[{name:'test',bucket:'fail'}]}); const r = await github.deliver(delivery);
  assert.equal(r.state, 'operator-required'); assert.equal(r.reasonCode, 'checks-failed'); assert.ok(!calls().some(a => a.includes('--undo')));
});
test('GitHub manual mode opens only', async () => {
  setup(); assert.equal((await github.deliver({...delivery,autoMerge:false})).merged,false); assert.equal(calls().length,1);
});
