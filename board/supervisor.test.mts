// Unit display/attribution plus one in-memory HTTP + durable tracker adapter boundary. No socket, paid worker or live tracker.
import { test } from 'node:test';
import fs from 'node:fs';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { sanitizeSupervisor, buildSupervisorData } from './supervisor.mts';
import { supervisorProjection, supervisorCommand } from '../cli/src/commands/supervisor.mts';
import { paths } from '../cli/src/paths.mts';
import { addProject } from '../cli/src/projects.mts';
import { factoryToml } from '../cli/test/config-fixture.mts';
import { reviewFixture, AT } from '../cli/test/supervisor-fixture.mts';
import { emptySupervisor, commitSupervisor, readSupervisor, supervisorFile } from '../cli/src/supervisor-state.mts';
import { supervisorHash } from '../orchestrator/supervisor-contract.mts';
import { deliverSupervisorRequest } from '../cli/src/supervisor-escalation.mts';
import { handleRequest } from './board-server.mts';
import { emptyAdmission, admissionFile } from './admission.mts';
import { exportEvents, supervisorOutcomeMetrics } from './execution-events.mts';

function view(s: ReturnType<typeof emptySupervisor>, offset = 0) {
  return supervisorProjection(s, { project: s.project, work: [] } as any, null, 'Host activation unavailable', offset);
}
test('projection retains exact proposal identity, review separation, known/unknown usage and complete paged holds; all output stays text', () => {
  const { input } = reviewFixture(), s = emptySupervisor(input.snapshot.project), hostile = '</script><img src=x onerror="x">&\'';
  s.proposals[input.proposal.id] = input.proposal;
  s.reservations['a'.repeat(64)] = { id: 'unknown-review', incidentId: input.proposal.incidentId, kind: 'review', owner: {pid:1,start:'fixture'}, fence:'fixture', at:AT, deadline:AT, reserved:{tokens:10,cost:100}, actual:null, state:'ambiguous', reviewId:null };
  s.charged.review = {tokens:10,cost:100};
  s.diagnostics={retained:{id:'retained',reservationId:'unknown-review',incidentId:input.proposal.incidentId,basisHash:'a'.repeat(64),snapshotHash:'b'.repeat(64),fence:'fixture',startedAt:AT,completedAt:AT,inputRef:'fixture:input',outcome:'proposed',reason:'Advice',stdout:'PRIVATE_RAW',stderr:'PRIVATE_ERROR',decision:{version:1,incidentId:input.proposal.incidentId,basisHash:'a'.repeat(64),classification:'expectation',rationale:'Keep useful retained rationale '+hostile,alternatives:['Inspect lawful alternative'],action:{kind:'wait',expectation:'Wait for exact owned evidence'}}}};
  for (let i = 0; i < 260; i++) {
    const id = i.toString(16).padStart(64, '0');
    s.humans[id] = { version: 1, id, project: s.project, scope: input.proposal.scope, incidentId: id, proposalId: input.proposal.id, reason: 'authority-uncertain', question: hostile,
      nextAction: 'Inspect /home/operator/.config/credentials/token.json and op://vault/item', evidence: ['https://user:pass@example.com/evidence?token=x#x'], stop: 'required', delivery: { state: 'pending', attempts: 0 } };
  }
  for (const path of ['[/home/operator/.ssh/id_ed25519]', '~/.ssh/id_ed25519', '.factory/credentials.json', 'path:/home/operator/.env', '`/home/operator/.config/credentials`']) {
    assert.doesNotMatch(sanitizeSupervisor('Inspect ' + path), /home\/operator|id_ed25519|credentials\.json|\.ssh/);
  }
  const before = JSON.stringify(s), all = [0,128,256].map(offset => sanitizeSupervisor(view(s, offset)));
  assert.equal(all.reduce((n,v) => n + v.humanRequests.length, 0), 260);
  assert.equal(all[0].pagination.collections.humanRequests.after, 132);
  assert.equal(all[0].hostDecision.humanRequired, true);
  assert.equal(all[0].hostDecision.actionAuthorized, false);
  assert.equal(all[0].telemetry.roles.review.accounting, 'unknown');
  assert.equal(all[0].telemetry.roles.review.unknownUsageReservations, 1);
  assert.deepEqual(all[0].telemetry.roles.review.charged, {tokens:10,cost:100});
  assert.equal(all[0].proposals[0].id, input.proposal.id);
  assert.equal(all[0].proposals[0].change.after, undefined);
  assert.equal(all[0].proposals[0].change.before, undefined);
  assert.equal(all[0].humanRequests[0].delivery.receipt, null);
  const serialized = JSON.stringify(all);
  assert.doesNotMatch(serialized, /user:pass|token=x|vault\/item|operator\/\.config|\/fixture\/project/);
  assert.equal(JSON.stringify(s), before);
  const code = readFileSync('board/board.template.html','utf8').split('// supervisor-render:start')[1].split('// supervisor-render:end')[0];
  const el = (tag: string, _class?: string, text = ''): any => ({ tag, text, children: [], appendChild(n: any) { this.children.push(n); }, replaceChildren() { this.children = []; }, set innerHTML(_: any) { assert.fail('No trusted HTML'); } });
  const paint = runInNewContext(code + '\npaintSupervisor', { el });
  const node = el('section'); paint(node, { generatedAt: AT, offset: 0, projects: [{ name: hostile, state: 'known', status: all[0] }] });
  assert.ok(JSON.stringify(node).includes('HUMAN DECISION NEEDED'));
  assert.ok(JSON.stringify(node).includes('Keep useful retained rationale'));
  assert.ok(JSON.stringify(node).includes('Inspect lawful alternative'));
  assert.ok(JSON.stringify(node).includes('Typed next step:'));
  assert.ok(JSON.stringify(node).includes('UNKNOWN'));
  assert.doesNotMatch(JSON.stringify(node),/PRIVATE_RAW|PRIVATE_ERROR/);
  assert.ok(JSON.stringify(node).includes(hostile.replace(/"/g,'\\"')));
});

test('offline HTTP reads never create/modify journal or deliver; explicit authorized bridge deduplicates uncertain delivery and keeps charges/fingerprints', async t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(),'board-supervisor-'))), p = paths(home), root = join(home,'project');
  t.after(() => rmSync(home,{recursive:true,force:true}));
  const oldHome = process.env.FACTORY_HOME, oldState = process.env.SANDCASTLE_STATE_DIR;
  process.env.FACTORY_HOME = home; process.env.SANDCASTLE_STATE_DIR = p.state;
  t.after(() => { if(oldHome === undefined) delete process.env.FACTORY_HOME; else process.env.FACTORY_HOME = oldHome; if(oldState === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = oldState; });
  mkdirSync(join(root,'.factory'),{recursive:true}); writeFileSync(join(root,'.factory/factory.toml'),factoryToml('owner/repo',{kind:'github'}));
  assert.equal(spawnSync('git',['init','-q'],{cwd:root}).status,0); addProject(p,root);
  const request = (url: string, method = 'GET') => new Promise<any>(resolve => {
    const headers: any = {}; let status = 200;
    handleRequest({ url, method, headers: {} } as any, { setHeader(k: string,v: string) { headers[k] = v; }, writeHead(s: number, h: any) { status = s; Object.assign(headers,h); }, end(body: string) { resolve({ status, headers, body: JSON.parse(body) }); } } as any);
  });
  let response = await request('/api/supervisor'); assert.equal(response.headers['cache-control'],'no-store'); assert.equal(response.body.projects[0].state,'known');
  assert.equal(response.body.projects[0].status.journal.state,'none');
  assert.equal(existsSync(supervisorFile(p.state)),false);
  const admission=emptyAdmission(),orphanProject=reviewFixture(root).input.snapshot.project;
  admission.supervisorHolds.orphan={id:'orphan',project:orphanProject,owner:{pid:2147483647,start:'fixture'},invocationId:'before-journal',fence:'f',pending:[],settled:[]};
  mkdirSync(join(p.state,'admission'),{recursive:true});writeFileSync(admissionFile(p.state),JSON.stringify(admission));
  const admissionBefore=readFileSync(admissionFile(p.state),'utf8');
  response=await request('/api/supervisor');assert.equal(response.body.projects[0].status.journal.state,'none');
  assert.equal(response.body.projects[0].status.admission.total,1);assert.equal(response.body.projects[0].status.admission.holds[0].ownership,'dead');
  assert.equal(readFileSync(admissionFile(p.state),'utf8'),admissionBefore);assert.equal(existsSync(supervisorFile(p.state)),false);
  for (const [url, method, status] of [['/api/supervisor','POST',405],['/api/supervisor?offset=-1','GET',400],['/api/supervisor?project=/etc/passwd','GET',400],['/api/supervisor?offset=0&offset=128','GET',400]]) {
    response = await request(url,method); assert.equal(response.status,status); assert.equal(response.headers['cache-control'],'no-store');
  }
  const {input,authorization} = reviewFixture(root), project = input.snapshot.project, incidentId = input.proposal.incidentId;
  const commit = (event: any) => { const s=readSupervisor(p.state,project); return commitSupervisor(p.state,project,s.revision,event); };
  commit({kind:'observe',id:'observe',at:AT,facts:authorization.facts,snapshotHash:supervisorHash(input.snapshot),reason:'Waiting on exact human decision'});
  commit({kind:'proposal',id:'proposal',at:AT,proposal:input.proposal});
  commit({kind:'human',id:'human',at:AT,request:{version:1,id:'human-request',project,scope:input.proposal.scope,incidentId,proposalId:input.proposal.id,reason:'review-denied',question:'Choose lawful evidence',evidence:['fixture:original'],nextAction:'Inspect exact proposal and original review',stop:'required',delivery:{state:'pending',attempts:0}}});
  const before = readFileSync(supervisorFile(p.state),'utf8');
  // Fail even if a forbidden call is caught by a read adapter. No host preparation, child/provider/tracker or mutation may run.
  let forbidden=0;
  const traps:any[]=[];
  const originalExecFileSync=cp.execFileSync;
  const deny=()=>{forbidden++;throw Error('Passive observation attempted a mutation or external call');};
  for (const [object,names] of [[fs,['writeFileSync','mkdirSync','renameSync','unlinkSync','rmSync','appendFileSync']],
    [cp,['spawn','spawnSync','exec','execSync','execFile']], [http,['request','get']], [https,['request','get']], [globalThis,['fetch']]] as any) {
    for (const name of names) traps.push(t.mock.method(object,name,deny));
  }
  // Canonical registered-root selection uses read-only git identity probes, not provider/tracker refresh.
  traps.push(t.mock.method(cp,'execFileSync',((file:string,args:string[],options:any)=>{
    if(file==='git' && args.includes('rev-parse') && (args.includes('--show-toplevel') || args.includes('--git-common-dir'))) return originalExecFileSync(file,args,options);
    return deny();
  }) as any));
  syncBuiltinESMExports();
  try {
    for (const command of ['status','explain']) {
      let body='';await supervisorCommand(p,command,[],{project:root,json:true},{output:text=>{body=text;}});
      assert.equal(JSON.parse(body).hostDecision.humanRequired,true);
    }
    response=await request('/api/supervisor');assert.equal(response.body.projects[0].status.hostDecision.humanRequired,true);
    assert.equal(forbidden,0);
  } finally {for (const trap of traps) trap.mock.restore();syncBuiltinESMExports();}
  assert.equal(readFileSync(supervisorFile(p.state),'utf8'),before);
  let posted = 0, comments: any[] = [];
  const adapter = { create(_p: any,_t: number,body: string): any { posted++; comments = [{id:'99',url:'https://github.com/owner/repo/issues/236#issuecomment-99',body}]; throw Error('Lost response'); }, list() { return comments; } };
  const deliver = (mode: 'observe'|'act'|'stopped', authorized: boolean) => deliverSupervisorRequest({stateDir:p.state,project,incidentId,current:()=>({mode,authorized}),adapter,now:()=>Date.parse(AT)});
  assert.equal(deliver('observe',true).state,'pending'); assert.equal(deliver('act',false).state,'pending'); assert.equal(deliver('stopped',true).state,'pending'); assert.equal(posted,0);
  assert.equal(deliver('act',true).state,'pending'); assert.equal(posted,1);
  const uncertain = readSupervisor(p.state,project); assert.equal(uncertain.humans[incidentId].stop,'required'); assert.equal(uncertain.humans[incidentId].delivery.state,'pending');
  assert.equal(deliver('act',true).state,'notified'); assert.equal(deliver('act',true).state,'notified'); assert.equal(posted,1);
  const after = readSupervisor(p.state,project); assert.deepEqual(after.charged,uncertain.charged); assert.deepEqual(after.incidents,uncertain.incidents); assert.equal(after.humans[incidentId].stop,'required');
  const events = exportEvents(p.state,{project:project.tracker.project}).events;
  assert.ok(events.some(e => e.supervisor?.outcome === 'notified'));
  assert.equal(supervisorOutcomeMetrics(events,[]).incidents[0].timeToConfirmedProgressMs,null);
  assert.equal(supervisorOutcomeMetrics(events,[{ticket:236,kind:'host-confirmed-merge',at:'2026-11-17T12:00:10.000Z'}]).incidents[0].timeToConfirmedProgressMs,10000);
  const bytes = readFileSync(supervisorFile(p.state),'utf8');
  writeFileSync(supervisorFile(p.state),'corrupt'); response = await request('/api/supervisor'); assert.equal(response.body.projects[0].state,'unknown'); assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(readFileSync(supervisorFile(p.state),'utf8'),'corrupt'); writeFileSync(supervisorFile(p.state),bytes);
  assert.equal((await buildSupervisorData(p.state,128,{read:async (project,offset) => { let body = ''; await supervisorCommand(p,'status',[],{project,json:true,offset:String(offset)},{output:text=>{body=text;}}); return JSON.parse(body); }})).projects[0].status!.revision,after.revision);
});
