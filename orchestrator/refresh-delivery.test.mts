// Scheduled copied dispatch delivery and fresh proof preservation.
import { createProof } from './verification.mts';
import { bindExecution, executionSnapshot } from '../cli/test/execution-fixture.mts';
import { modelForRole } from './model-policy.mts';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAssets } from "../cli/src/scaffold.mts";
import { readAssessment, requestRefresh } from "../board/assessment.mts";
import { fixtureTicketHash } from './fixtures/ticket-input.mts';

import { FIXTURES, git, ticket, fixture } from "./refresh-fixture.mts";

for (const changedInstructions of [false, true]) test(`scheduled copied dispatch: ${changedInstructions ? 'changed instructions revoke existing proof' : 'pending then green uses same proof/PR'}`, async t => {
  const f = fixture(t), sc = join(f.root, '.factory');
  writeFileSync(join(f.root, 'authority.md'), 'original authority');
  const configPath = join(sc, 'factory.toml');
  writeFileSync(configPath, f.bytes(configPath) + '\n[instructions]\ncommon = ["authority.md"]\n');
  const snapshot = executionSnapshot(f.runtime, f.root);
  f.data.tickets[0].description = 'Model tier: mid\nDeliver this behavior';
  f.data.openBranches = ['7-topic']; f.manifest(7);
  git(f.root,'branch','7-topic'); git(f.root,'push','-q','origin','7-topic');
  const tip = git(f.root,'rev-parse','7-topic');
  const cfg = { ...snapshot.config, AGENT: { model: modelForRole('anthropic', 'verification').model, thinking: 'high' } };
  const evidence = join(f.home,'evidence'); mkdirSync(evidence);
  writeFileSync(join(evidence,'verdict.md'),'VERDICT: PASS\n'); writeFileSync(join(evidence,'out.txt'),'verified');
  writeFileSync(join(evidence,'verification.json'),JSON.stringify({version:1,verdict:'PASS',changeKind:'feature',evidenceKind:'command',interactive:false,criteria:[{requirement:'behavior',result:'pass',evidence:['out.txt']}],artifacts:[{path:'out.txt',kind:'command-output',phase:'check'}],limitations:[]}));
  const code = Object.fromEntries(f.runtime.manifest.files.map(file => [file.path, file.sha256]));
  const settings = {image:cfg.config.image,model:cfg.AGENT.model,thinking:cfg.AGENT.thinking??null,merge:{auto:cfg.MERGE.auto,method:cfg.MERGE.method,requiredChecks:cfg.MERGE.requiredChecks??[]},ciWaitMinutes:cfg.config.ciWaitMinutes,noPipelineMinutes:cfg.config.noPipelineMinutes,execution:snapshot.identity};
  const hash = fixtureTicketHash(f.data, 7);
  const identity = {project:'owner/repo',ticket:'7',executionId:'execution',branch:'7-topic',base:'main',baseline:tip,tip,requirementsHash:hash};
  const proof = createProof(f.dir,evidence,identity,{imageId:`sha256:${'a'.repeat(64)}`,nodeVersion:'v22',settings,code});
  const at = new Date().toISOString(), path = join(f.dir,`${f.key(7)}.json`);
  writeFileSync(path,JSON.stringify({iid:'7',project:'owner/repo',stage:'waiting',stageSince:at,startedAt:at,updatedAt:at,pid:process.pid,executionId:'execution',evidenceDir:join(f.root,'.factory/evidence/7/execution'),branch:'7-topic',base:'main',implementationBaseSha:tip,verdict:'PASS',verification:{id:proof.id,tip,requirementsHash:hash},delivery:{version:1,kind:'github',host:'github.com',repository:'owner/repo',number:1,url:'https://github.com/owner/repo/pull/1',branch:'7-topic',base:'main',sha:tip,project:'owner/repo',ticket:'7',executionId:'execution',proofId:proof.id,state:'ci-waiting',reasonCode:'opened',observedAt:at}}));
  f.data.delivery={sha:tip,pending:true};
  const cli = join(f.home,'trusted-cli.mjs');
  writeFileSync(cli,`import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(f.fake,'status-calls'))},JSON.stringify(process.argv.slice(2))+'\\n'); console.log(JSON.stringify({version:1,scheduler:{serviceEnabled:true,timerActive:true},projects:[{root:${JSON.stringify(f.root)},schedule:{enabled:true,branch:'main'},blocker:null}]}));`);
  const scheduled={FACTORY_SCHEDULED:'1',FACTORY_CLI_ENTRYPOINT:cli,FACTORY_SCHEDULER_NODE:process.execPath};
  f.pass(); f.pass(['--refresh-only'],scheduled); f.pass(['--dry-run'],scheduled);
  assert.equal(f.bytes(join(f.fake,'status-calls')),'absent');
  f.pass([],scheduled); assert.equal(JSON.parse(f.bytes(path)).delivery.state,'ci-waiting');
  if (changedInstructions) writeFileSync(join(f.root, 'authority.md'), 'changed authority');
  f.data.delivery.pending=false; f.pass([],scheduled);
  if (changedInstructions) {
    const calls = f.bytes(join(f.fake,'tracker.jsonl')).split('\n').filter(Boolean).map(s => JSON.parse(s));
    assert.ok(!calls.some(a => a.includes('repos/owner/repo/pulls/1/merge')), 'changed inputs cannot authorize the existing proof');
    assert.notEqual(JSON.parse(f.bytes(path)).delivery.state, 'merged');
    return;
  }
  const done=JSON.parse(f.bytes(path)); assert.equal(done.delivery.state,'merged'); assert.equal(done.stage,'done'); assert.equal(done.verification.id,proof.id); assert.equal(done.verdict,'PASS');
  const calls=f.bytes(join(f.fake,'tracker.jsonl')).split('\n').filter(Boolean).map(s=>JSON.parse(s));
  assert.equal(calls.filter(a=>a.includes('repos/owner/repo/pulls/1/merge')).length,1);
  assert.ok(!calls.some(a=>a.includes('create')||a.includes('comment')||a.includes('--undo'))); assert.equal(f.bytes(join(f.fake,'launches')),'absent');
  assert.ok(f.bytes(join(f.fake,'status-calls')).split('\n').filter(Boolean).every(s=>JSON.stringify(JSON.parse(s))===JSON.stringify(['schedule','status','--project',f.root,'--json'])));
});

