// #137: copied-scaffold authority, explanation, legacy preservation and bootstrap integration.
// Strict tracker/launch stubs, temporary Git projects/state; no credentials, Docker, agents or services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { resolveProject } from '../src/runs.mts';
import { trackerIdentity } from '../src/recovery-run.mts';
import { buildAssets, writeScaffold } from '../src/scaffold.mts';
import { classifyCopy, applyCopy } from '../src/update.mts';
const cli = resolve('cli/bin/factory.mts');
function fixture(t: any, profile: 'personal' | 'client' = 'personal') {
  const base = mkdtempSync(join(tmpdir(), 'factory toml-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'project checkout'), home = join(base, 'home'), bin = join(base, 'bin');
  for (const d of [root, home, bin]) mkdirSync(d);
  execFileSync('git', ['init','-q',root]);
  const p = paths(home), sc = join(root, '.sandcastle');
  writeScaffold(root, buildAssets({ profile, repo: 'new/project', image: 'sandcastle-test', host: 'git.example.com', projectId: 42 }, p.state));
  addProject(p, root);
  const toml = join(sc,'factory.toml');
  writeFileSync(toml, readFileSync(toml, 'utf8').replace('units = "subtasks"','units = "issues"'));
  writeFileSync(join(sc,'config.mts'), `throw new Error('EXECUTED_LEGACY');`);
  const calls = join(base,'calls.jsonl');
  const stub = `#!${process.execPath}
import fs from 'node:fs';
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({args:a,host:process.env.GH_HOST ?? process.env.GITLAB_HOST})+'\\n');
if (a[0] === 'issue' && a[1] === 'view' && a.includes('--json')) {
 console.log(JSON.stringify({number:7,title:'Ticket',body:'**Model:** sonnet',state:'OPEN',labels:[{name:'ready-for-agent'}],assignees:[],author:{login:'alice'},milestone:null}));
} else if (a[0] === 'issue' && a[1] === 'list') {
 if (process.env.FAIL_LIST) process.exit(9);
 const count = Number(process.env.COUNT ?? '1');
 const issues = Array.from({length:count},(_,i)=>({number:i===0?7:i+100,title:'Ticket',body:'',state:'OPEN',labels:[],assignees:process.env.EXCLUDED?[{login:'alice'}]:[]}));
 console.log(JSON.stringify(issues));
} else if(a[0] === 'api' && a[1] === 'user') console.log(JSON.stringify({login:'alice',username:'alice'}));
else if(a[0] === 'api' && a[1] === 'graphql') {
 const parent = process.env.PARENT ? {number:7} : null;
 const subIssues = {nodes:process.env.CHILDREN ? [{number:8,state:'CLOSED'}]:[]};
 console.log(JSON.stringify({data:{repository:{i7:{parent,subIssues}}}}));
} else { console.error('UNEXPECTED TRACKER CALL: '+JSON.stringify(a)); process.exit(97); }
`;
  for (const cmd of ['gh','glab']) writeFileSync(join(bin,cmd),stub,{mode:0o755});
  const env = { ...process.env, HOME: home, FACTORY_HOME: home, SANDCASTLE_STATE_DIR: p.state, PATH: `${bin}:${process.env.PATH}` };
  const run = (args: string[], extra: Record<string,string> = {}) => spawnSync(process.execPath,[cli,...args],{cwd:root,env:{...env,...extra},encoding:'utf8'});
  const explain = (extra: Record<string,string> = {}) => run(['selection','explain','7','--json'],extra);
  return {base,root,sc,p,toml,calls,run,explain,env};
}
function snapshot(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>[join(e.parentPath,e.name),readFileSync(join(e.parentPath,e.name),'utf8')]);
}
test('copied runtime ignores executable legacy config; missing TOML retains it; invalid TOML never falls back', t => {
  const f = fixture(t);
  const code = `import { TRACKER, effectiveConfig } from './.sandcastle/runtime-config.mts'; console.log(JSON.stringify([TRACKER.project,effectiveConfig.source.mode]));`;
  const run = () => spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.deepEqual(JSON.parse(run().stdout),['new/project','toml']);
  writeFileSync(f.toml,'version = 999');
  assert.match(run().stderr,/factory.toml.*version/); assert.doesNotMatch(run().stderr,/EXECUTED_LEGACY/);
  rmSync(f.toml); assert.match(run().stderr,/EXECUTED_LEGACY/);
  writeFileSync(join(f.sc,'config.mts'),`export const TRACKER={project:'legacy/project'},AGENT={},MERGE={},LABELS={},SUBTASKS={},GRAPH={}; export const allLabels=()=>['custom legacy label'];`);
  const legacy = spawnSync(process.execPath,['--input-type=module','-e',`import { TRACKER, allLabels, effectiveConfig } from './.sandcastle/runtime-config.mts'; console.log(JSON.stringify([TRACKER.project,allLabels(),effectiveConfig ?? null]));`],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(legacy.status,0,legacy.stderr); assert.deepEqual(JSON.parse(legacy.stdout),['legacy/project',['custom legacy label'],null]);
});
test('explain evaluates membership and exclusions without writing state or invoking mutators', t => {
  const f = fixture(t);
  mkdirSync(f.p.state,{recursive:true});
  writeFileSync(join(f.p.state,'new_project--7.json'),JSON.stringify({iid:'7',project:'new/project',stage:'queued',pid:0,note:'previous hold'}));
  const before = snapshot(f.p.state);
  let r = f.explain(); assert.equal(r.status,0,r.stderr);
  const output = JSON.parse(r.stdout);
  assert.equal(output.eligibility,'selected'); assert.equal(output.source.mode,'toml');
  assert.equal(output.settings.dispatch.maxConcurrent,3); assert.equal(output.settings.sources['dispatch.max_concurrent'],'explicit');
  assert.equal(output.executionHolds.status,'unknown');
  r = f.explain({COUNT:'0'}); assert.equal(r.status,0,r.stderr); assert.equal(JSON.parse(r.stdout).eligibility,'not-selected');
  r = f.explain({FAIL_LIST:'1'}); assert.equal(r.status,1); assert.equal(JSON.parse(r.stdout).eligibility,'unknown');
  r = f.explain({COUNT:'1000'}); assert.equal(r.status,1); assert.equal(JSON.parse(r.stdout).eligibility,'unknown');
  writeFileSync(f.toml,readFileSync(f.toml,'utf8').replace('exclude_assignees = []','exclude_assignees = ["@me"]'));
  r = f.explain({EXCLUDED:'1'}); assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).reasons[0].code,'excluded-assignee');
  assert.deepEqual(snapshot(f.p.state),before);
  assert.ok(readFileSync(f.calls,'utf8').trim().split('\n').every(s => JSON.parse(s).host === 'github.com'));
});
test('TOML native filters, labels, milestone and ordering reach the same adapter query', t => {
  const f = fixture(t);
  writeFileSync(f.toml,readFileSync(f.toml,'utf8').replace('[selection]', '[selection]\nmilestone = "Sprint with spaces"\nassignee = "alice"\nauthor = "bob"\nsearch = "native search"')
    .replace('by = "created"','by = "updated"').replace('direction = "asc"','direction = "desc"'));
  const r = f.explain(); assert.equal(r.status,0,r.stderr);
  const calls = readFileSync(f.calls,'utf8').trim().split('\n').map(s=>JSON.parse(s).args as string[]);
  const list = calls.find(a=>a[0]==='issue' && a[1]==='list')!;
  for (const [flag,value] of [['--milestone','Sprint with spaces'],['--assignee','alice'],['--author','bob'],['--label','ready-for-agent']]) assert.equal(list[list.indexOf(flag)+1],value);
  const search = list[list.indexOf('--search')+1];
  assert.match(search,/sort:updated-desc/); assert.match(search,/native search/); assert.match(search,/-label:"needs-human"/);
});

test('explain subtask mode reports all-children-closed and inheritance without requiring child labels', t => {
  const f = fixture(t);
  writeFileSync(f.toml,readFileSync(f.toml,'utf8').replace('units = "issues"','units = "subtasks"'));
  let r = f.explain({CHILDREN:'1'}); assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).reasons[0].code,'all-children-closed');
  r = f.explain({PARENT:'1'}); assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).inheritedFrom,7);
  assert.equal(JSON.parse(r.stdout).eligibility,'selected');
});
test('copied CLI app outside the source checkout explains without app or project node_modules', t => {
  const f = fixture(t), app = join(f.base,'installed-app'); mkdirSync(app);
  for (const dir of ['cli','board','orchestrator']) cpSync(resolve(dir),join(app,dir),{recursive:true});
  const r = spawnSync(process.execPath,[join(app,'cli/bin/factory.mts'),'selection','explain','7','--json'],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); assert.equal(JSON.parse(r.stdout).eligibility,'selected');
  assert.equal(existsSync(join(app,'node_modules')),false); assert.equal(existsSync(join(f.root,'node_modules')),false);
});

test('legacy explanation is honest and never imports customized config/dispatch/main', t => {
  const f = fixture(t); rmSync(f.toml);
  writeFileSync(join(f.sc,'config.mts'),'export const TRACKER = {\n project: "legacy/project",\n};\nthrow new Error("EXECUTED_LEGACY");');
  const r = f.explain(); assert.equal(r.status,1,r.stderr);
  assert.equal(JSON.parse(r.stdout).source.mode,'legacy');
  assert.equal(JSON.parse(r.stdout).reasons[0].code,'legacy-unsupported');
  assert.equal(existsSync(f.calls),false);
});
test('init repair and update never migrate legacy or overwrite TOML; vendor ships without node_modules', t => {
  const f = fixture(t); const original = readFileSync(f.toml);
  writeScaffold(f.root,buildAssets({profile:'client',repo:'other/project',image:'other',host:'other.host',projectId:4},f.p.state));
  assert.deepEqual(readFileSync(f.toml),original);
  rmSync(f.toml);
  writeScaffold(f.root,buildAssets({profile:'personal',repo:'other/project',image:'other'},f.p.state));
  assert.equal(existsSync(f.toml),false);
  assert.equal(classifyCopy(f.p,f.root).find(f=>f.file==='factory.toml')!.class,'project');
  applyCopy(f.p,f.root); assert.equal(existsSync(f.toml),false);
  assert.equal(existsSync(join(f.root,'node_modules')),false);
  assert.ok(existsSync(join(f.sc,'vendor/smol-toml/LICENSE')));
});
test('shell preflight uses TOML tracker/agent/image, not conflicting legacy code, before project npm install', t => {
  const f = fixture(t,'client');
  execFileSync('git',['-C',f.root,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-qm','Fixture']);
  const origin = join(f.base,'local-origin.git');
  execFileSync('git',['init','--bare','-q',origin]);
  execFileSync('git',['-C',f.root,'remote','add','origin',origin]);
  execFileSync('git',['-C',f.root,'push','-q','origin','HEAD']);
  const bin = f.env.PATH.split(':')[0], log = join(f.base,'preflight.jsonl');
  const script = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const tool = path.basename(process.argv[1]), a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([tool,...a])+'\\n');
if(tool==='glab' && JSON.stringify(a)===JSON.stringify(['auth','status','--hostname','git.example.com'])) process.exit(0);
if(tool==='claude' && JSON.stringify(a)===JSON.stringify(['auth','status'])) { console.log('{"loggedIn":true}'); process.exit(0); }
if(tool==='docker' && a[0]==='info') process.exit(0);
if(tool==='docker' && a[0]==='image' && a[1]==='inspect' && a[2]==='sandcastle-test') { console.log(''); process.exit(0); }
if(tool==='curl' && a.includes('https://api.anthropic.com/v1/messages')) { console.log('400'); process.exit(0); }
console.error('unexpected '+tool+' '+JSON.stringify(a));process.exit(91);
`;
  for(const name of ['glab','claude','docker','curl','npm','npx']) writeFileSync(join(bin,name),script,{mode:0o755});
  // Avoid dependency bootstrap without borrowing any source-checkout dependencies.
  mkdirSync(join(f.root,'node_modules/@ai-hero/sandcastle'),{recursive:true});
  writeFileSync(join(f.sc,'.env'),'CLAUDE_CODE_OAUTH_TOKEN=fixture-only\n');
  writeFileSync(join(f.sc,'dispatch.mts'),`import { TRACKER, AGENT, effectiveConfig } from './runtime-config.mts'; console.log(JSON.stringify([TRACKER.project,AGENT.provider,effectiveConfig.config.image]));`);
  const r = spawnSync('bash',[join(f.sc,'dispatch.sh'),'--dry-run'],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()),['new/project','claude','sandcastle-test']);
  assert.ok(!readFileSync(log,'utf8').includes('"npm"'));
  assert.equal(existsSync(f.calls),false);
});

test('shell validates malformed TOML before credential, Docker, npm or dispatch calls', t => {
  const f = fixture(t); writeFileSync(f.toml,'version = 0');
  const r = spawnSync('bash',[join(f.sc,'dispatch.sh')],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(r.status,1); assert.match(r.stderr,/factory.toml.*version/);
  assert.equal(existsSync(f.calls),false);
  assert.equal(existsSync(join(f.root,'node_modules')),false);
});
test('metadata resolves the linked worktree version without executing legacy config', t => {
  const f = fixture(t);
  execFileSync('git',['-C',f.root,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--allow-empty','-qm','Fixture']);
  const wt = join(f.base,'linked checkout');
  execFileSync('git',['-C',f.root,'worktree','add','-qb','fixture-linked',wt]);
  cpSync(f.sc,join(wt,'.sandcastle'),{recursive:true});
  const toml = join(wt,'.sandcastle/factory.toml');
  writeFileSync(toml,readFileSync(toml,'utf8').replace('new/project','worktree/project').replace('host = "github.com"','host = "github.example.com"'));
  const ctx = resolveProject(f.p,{cwd:wt});
  assert.equal(ctx.root,wt); assert.equal(ctx.tracker,'worktree/project');
  assert.deepEqual(trackerIdentity(wt),{kind:'github',host:'github.example.com',project:'worktree/project'});
  writeFileSync(toml,'version = 0');
  assert.throws(()=>resolveProject(f.p,{cwd:wt}),/factory.toml.*version/);
  assert.throws(()=>trackerIdentity(wt),/factory.toml.*version/);
});

test('bootstrap scalar helper safely returns data with spaces and never interprets commands', t => {
  const f = fixture(t);
  writeFileSync(f.toml,readFileSync(f.toml,'utf8').replace('image = "sandcastle-test"','image = "image with spaces $(touch BAD)"'));
  const r = spawnSync(process.execPath,[join(f.sc,'config-read.mts'),f.sc,'image'],{cwd:f.root,env:f.env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); assert.equal(r.stdout,'image with spaces $(touch BAD)'); assert.equal(existsSync(join(f.root,'BAD')),false);
});
