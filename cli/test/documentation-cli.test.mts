// Exercise documented operator forms against disposable projects and fake scheduler/workflow boundaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { home, repo, repoRoot, systemctlStub, factoryBin } from './schedule-helpers.mts';
import { bindExecution } from './execution-fixture.mts';
import { recoveryCopyProblem, readReview } from '../src/recovery-review.mts';
import { projectWorkflow } from '../src/workflow.mts';
import { refreshManifest } from './workflow-fixture.mts';
import { writeScheduleConfig } from '../src/schedule.mts';
import { tick } from '../src/commands/tick.mts';
import { FakeSchedule } from '../src/platform/fake.mts';

const docs = readFileSync(new URL('../../docs/factory-cli.md', import.meta.url), 'utf8');

test('documented operator forms agree with CLI help and parser', t => {
  const {home: dir, p} = home(t); const root = repo(p, 'site'); const stub = systemctlStub(t, p);
  const env = { ...process.env, ...stub.env, HOME: dir, FACTORY_HOME: dir };
  const cli = (args: string[]) => spawnSync(process.execPath, [factoryBin, ...args], {cwd: root, env, encoding: 'utf8'});
  const help = cli(['--help']); assert.equal(help.status, 0, help.stderr);
  const forms = [
    'factory dispatch [--dry-run] [--max N] [--whole-issues] [--project <name>]',
    'factory run <ticket> [--project <name>]',
    'factory schedule status [--project <name|path>] [--json]',
    'factory recovery status [--project <name|path>] [--json]',
  ];
  // These forms are taken from the operator reference, not reconstructed from CLI help.
  assert.match(docs, /factory dispatch\s+one pass \(--dry-run, --max N, --whole-issues\)/);
  assert.match(docs, /factory run <ticket>/);
  for (const form of forms.slice(2)) assert.ok(docs.includes(form), form);
  for (const [command, options] of [['dispatch',['--dry-run','--max','--whole-issues','--project']], ['run',['--project']], ['schedule',['--project','--json']], ['recovery',['--project','--json']]] as const) {
    const line = help.stdout.split('\n').find(l => l.startsWith(`factory ${command} `));
    assert.ok(line, command); for (const option of options) assert.ok(line.includes(option), `${command} ${option}`);
  }
  for (const args of [['schedule','status','--project',root,'--json'], ['recovery','status','--project',root,'--json']]) {
    const result = cli(args); assert.equal(result.status, 0, result.stderr); assert.doesNotThrow(() => JSON.parse(result.stdout));
  }
  assert.ok(docs.includes('factory schedule on|off --project <name|path>'));
  assert.ok(docs.includes('factory recovery reset [--project <name|path>]'));
  for (const args of [['schedule','on','--project',root], ['schedule','off','--project',root], ['recovery','reset','--project',root]]) {
    const result = cli(args); assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.equal(stub.rejected().length, 0);
});

test('documented launch and refresh forms select the project runtime safely', {timeout: 30000}, async t => {
  const {home: dir, p} = home(t); const log = join(dir, 'calls.jsonl');
  const script = `#!/bin/sh\nexec node -e 'require("fs").appendFileSync(process.env.RECORD, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1),runtime:process.env.FACTORY_RUNTIME_ROOT,mode:process.env.FACTORY_WORKFLOW_MODE,readonly:process.env.FACTORY_REFRESH_ONLY})+"\\n")' -- "$@"\n`;
  const root = repo(p, 'site', {script});
  writeFileSync(join(root, '.factory-workflow/dispatch.mts'), `import {appendFileSync} from 'node:fs'; appendFileSync(process.env.RECORD, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),runtime:process.env.FACTORY_RUNTIME_ROOT,mode:process.env.FACTORY_WORKFLOW_MODE,readonly:process.env.FACTORY_REFRESH_ONLY})+'\\n');`);
  refreshManifest(root); const selected = projectWorkflow(p, root);
  const env = { ...process.env, HOME: dir, FACTORY_HOME: dir, RECORD: log, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  // Normalize the documented <ticket> and <name|path> placeholders to fixture values.
  assert.match(docs, /factory run <ticket>/); assert.match(docs, /factory dispatch\s+one pass \(--dry-run, --max N, --whole-issues\)/);
  for (const args of [['dispatch','--dry-run','--max','2','--whole-issues','--project',root], ['run','7','--project',root]]) {
    const result = spawnSync(process.execPath, [factoryBin, ...args], {cwd:root, env, encoding:'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.ok(docs.includes('factory tick')); assert.ok(docs.includes('--refresh-only'));
  writeScheduleConfig(p, { node: process.execPath, path: env.PATH });
  const backend = new FakeSchedule(p); backend.enabled = true; backend.timer = 'active';
  // The scheduler boundary is injected; its refresh still spawns the actual selected fixture dispatcher.
  const saved = process.env.RECORD; process.env.RECORD = log;
  try { const result = await tick(p, { backend, log: () => {}, maintenance: () => {} }); assert.equal(result.refreshed.site, 'ok'); }
  finally { if (saved === undefined) delete process.env.RECORD; else process.env.RECORD = saved; }
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 3);
  for (const call of calls) { assert.equal(call.cwd, root); assert.equal(call.runtime, selected.root); assert.equal(call.mode, 'project'); }
  assert.deepEqual(calls[0].args, ['--dry-run','--max','2','--whole-issues']);
  assert.deepEqual(calls[1].args, ['--issue','7']);
  assert.deepEqual(calls[2].args, ['--refresh-only','--base','main']);
});


test('documented selection, update, workflow status and review CLI forms stay safe', {timeout: 30000}, t => {
  const {home: dir, p} = home(t); const root = repo(p, 'site', {push: false});
  const config = join(root, '.factory/factory.toml');
  const projectConfig = readFileSync(config, 'utf8');
  writeFileSync(config, projectConfig.replace(/\n\[workflow\][\s\S]*$/, '\n') + '\n[work]\nunits = "issues"\n');
  const runtime = bindExecution(root, {}, {paths: p, overlays: false});
  const bin = join(dir, 'safe-bin'), calls = join(dir, 'tracker-calls'); mkdirSync(bin);
  symlinkSync('/usr/bin/git', join(bin, 'git'));
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nconst fs=require('node:fs'), a=process.argv.slice(2); fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n'); const issue={number:7,title:'fixture',body:'',state:'OPEN',labels:[{name:'ready-for-agent'}],assignees:[],author:{login:'a'},milestone:null}; if(a[0]!=='issue'||!['view','list'].includes(a[1])) process.exit(99); console.log(JSON.stringify(a[1]==='view'?issue:[issue]));\n`, {mode:0o755});
  for (const name of ['npm','docker','systemctl','gh-axi','op','ssh','curl']) writeFileSync(join(bin,name), '#!/bin/sh\nexit 99\n', {mode:0o755});
  const env = { HOME:dir, FACTORY_HOME:dir, PATH:bin, CALLS:calls, GIT_CONFIG_NOSYSTEM:'1' };
  const cli = (args:string[]) => { const r = spawnSync(process.execPath, [factoryBin,...args], {cwd:root, env, encoding:'utf8'}); assert.equal(r.status, 0, r.stdout+r.stderr); return r.stdout; };
  const snapshot = (base:string): unknown => !existsSync(base) ? null : readdirSync(base, {recursive:true}).sort().map(name => { const path=join(base,String(name)), st=lstatSync(path); return [name, st.mode, st.mtimeMs, st.isFile()?readFileSync(path).toString('base64'):null]; });
  assert.ok(docs.includes('factory selection explain <ticket> [--project <name|path>] [--json]'));
  const before = snapshot(root), state = snapshot(p.state);
  const selection = JSON.parse(cli(['selection','explain','7','--project',root,'--json']));
  assert.equal(selection.eligibility, 'selected'); assert.equal(selection.workflow.identity, runtime.id);
  const tracker = readFileSync(calls,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(tracker.length,2); assert.ok(tracker.every(a=>a[0]==='issue' && ['view','list'].includes(a[1])));
  assert.deepEqual(snapshot(root),before); assert.deepEqual(snapshot(p.state),state);
  assert.ok(docs.includes('`factory update --dry-run` and `--apply`'));
  for (const flag of ['--dry-run','--apply']) {
    const report = JSON.parse(cli(['update',flag,'--project',root,'--json']));
    assert.ok(report.files.every((row:{class:string}) => row.class === 'project'));
    if (flag === '--apply') { assert.deepEqual(report.created,[]); assert.deepEqual(report.replaced,[]); }
    assert.deepEqual(snapshot(root),before);
  }
  // Apply records host telemetry, but workflow status itself is read-only.
  const stateAfterUpdate = snapshot(p.state);
  assert.ok(docs.includes('factory workflow status --source /path/to/factory --project /path/to/project --json'));
  assert.ok(docs.includes('factory workflow status --source /path/to/factory --docker-socket /run/user/1000/docker.sock --json'));
  const status = JSON.parse(cli(['workflow','status','--source',repoRoot,'--project',root,'--docker-socket',join(dir,'absent.sock'),'--json']));
  assert.equal(status.version,1); assert.equal(status.projectCopy.root,root); assert.ok(status.source); assert.equal(status.image.inspection.state,'unknown');
  assert.deepEqual(snapshot(root),before); assert.deepEqual(snapshot(p.state),stateAfterUpdate);
  writeFileSync(config,projectConfig);
  assert.ok(docs.includes('factory recovery review [--project <name|path>]'));
  assert.ok(docs.includes('factory recovery review --confirm [--project <name|path>]'));
  assert.equal(readReview(p,root),null); const projectBefore = snapshot(root);
  cli(['recovery','review','--project',root]); assert.equal(readReview(p,root),null);
  assert.deepEqual(snapshot(root),projectBefore);
  cli(['recovery','review','--confirm','--project',root]); assert.ok(readReview(p,root));
  assert.equal(recoveryCopyProblem(p,root),null); assert.deepEqual(snapshot(root),projectBefore);
});
