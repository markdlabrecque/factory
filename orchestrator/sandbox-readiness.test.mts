// Offline actual-user probe fixtures: disposable Git, injected Docker and shared local reports only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SANDBOX_PROBE_PROGRAM, probeSandbox, sandboxReadinessHold, closeSandbox, recordSandboxCleanup } from './sandbox-readiness.mts';
import { validReport } from './readiness-schema.mts';
import { realProc } from './recovery-sandbox.mts';

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-readiness-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const git = (...args: string[]) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
  git('init','-q'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.test');
  writeFileSync(join(root,'required.md'),'required'); git('add','.'); git('commit','-qm','baseline');
  const baseline = git('rev-parse','HEAD');
  writeFileSync(join(root,'required.md'),'staged'); git('add','.'); writeFileSync(join(root,'required.md'),'UNIQUE_PRIVATE_FILE_CONTENT');
  writeFileSync(join(root,'untracked'),'preserve');
  const evidence = join(root,'evidence'); mkdirSync(evidence);
  const input = {uid:process.getuid!(),gid:process.getgid!(),baseline,tip:baseline,evidence,files:{'required.md':null}};
  const run = (overrides = {}, script = SANDBOX_PROBE_PROGRAM) => JSON.parse(execFileSync(process.execPath,['-e',script,JSON.stringify({...input,...overrides})],{cwd:root,encoding:'utf8'}));
  return {root,git,input,run};
}

test('locked SDK map: actual identity, resolved Git/evidence paths and unchanged dirty user work', t => {
  const f = fixture(t);
  const index = readFileSync(join(f.root,'.git/index'));
  const refs = f.git('show-ref','--head'), status = f.git('status','--porcelain');
  const out = f.run();
  assert.deepEqual(out.identity,{uid:process.getuid!(),gid:process.getgid!()});
  assert.equal(out.workspace,f.root); assert.equal(out.metadata,join(f.root,'.git')); assert.equal(out.index,join(f.root,'.git/index'));
  assert.ok(out.checks.every((c:any) => c.status === 'ready'),JSON.stringify(out));
  assert.deepEqual(readFileSync(join(f.root,'.git/index')),index);
  assert.equal(f.git('show-ref','--head'),refs); assert.equal(f.git('status','--porcelain'),status);
  for (const dir of [f.root,join(f.root,'.git'),f.input.evidence]) assert.ok(!readdirSync(dir).some(n => n.startsWith('.factory-readiness-') || n.endsWith('.lock')));
});

for (const [name,operation,code] of [
  ['workspace','workspace-create-write-rename-remove','EROFS'],
  ['evidence','evidence-create-write-rename-remove','EACCES'],
  ['index','alternate-index-read-tree','EACCES'],
] as const) test(`${name} permissions fail under any runner UID and leave no probes`, t => {
  const f = fixture(t);
  // Inject syscall faults, not chmod: this also tests root runners.
  const predicate = name === 'workspace' ? 'dir === workspace' : name === 'evidence' ? 'dir === input.evidence' : 'dir === p.dirname(index)';
  const script = SANDBOX_PROBE_PROGRAM.replace('const privateDir = dir => {',`const privateDir = dir => { if(${predicate}) throw error('${code}');`);
  const out = f.run({},script);
  assert.ok(out.checks.some((c:any) => c.operation === operation && c.errno === code));
  assert.ok(out.checks.some((c:any) => c.id === 'work-preservation' && c.status === 'ready'));
  assert.ok(out.checks.some((c:any) => c.id === 'probe-cleanup' && c.status === 'ready'));
});
test('missing baseline and identity mismatch fail closed', t => {
  const f = fixture(t);
  assert.ok(f.run({baseline:'0'.repeat(40)}).checks.some((c:any) => c.id === 'probe-failure'));
  assert.ok(f.run({uid:process.getuid!()+1}).checks.some((c:any) => c.errno === 'EIDENTITY'));
});
test('shared sandbox report uses exact-container default user execution and publishes no file bodies', async t => {
  const f = fixture(t), calls: string[][] = [];
  const report = await probeSandbox({container:'fixture-container',state:f.root,identity:{projectRoot:f.root,runtimeIdentity:'fixture',configIdentity:'fixture',contextFingerprint:'fixture'},invocationId:'test',...f.input}, async (cmd,args,o) => {
    assert.equal(cmd,'docker'); calls.push(args);
    assert.deepEqual(args.slice(0,4),['exec','fixture-container','node','-e']);
    return realProc(process.execPath,args.slice(3),{...o,cwd:f.root});
  });
  assert.equal(report.status,'ready',JSON.stringify(report)); assert.ok(validReport(report));
  assert.equal(calls.length,1); assert.equal(sandboxReadinessHold(report),undefined);
  assert.ok(!JSON.stringify(report).includes('UNIQUE_PRIVATE_FILE_CONTENT'));
});
test('cancel/timeout produces unknown work and cleanup, never success', async t => {
  const f = fixture(t);
  const report = await probeSandbox({container:'fixture-container',state:f.root,identity:{projectRoot:f.root,runtimeIdentity:'fixture',configIdentity:'fixture',contextFingerprint:'fixture'},invocationId:'test',...f.input,timeoutMs:20},async (_cmd,_args,o) => realProc(process.execPath,['-e','setInterval(()=>{},1000)'],o));
  assert.equal(report.status,'unknown'); assert.match(sandboxReadinessHold(report)!,/unconfirmed/);
});

test('linked worktree resolves its actual external index; split index and configured Git commands stay disabled', t => {
  const f = fixture(t), worktree = join(f.root,'linked');
  f.git('worktree','add','-qb','linked',worktree);
  f.git('config','core.splitIndex','true');
  f.git('config','core.fsmonitor',`touch ${join(f.root,'UNSAFE_COMMAND')}`);
  f.git('config','diff.external',`touch ${join(f.root,'UNSAFE_COMMAND')}`);
  const out = JSON.parse(execFileSync(process.execPath,['-e',SANDBOX_PROBE_PROGRAM,JSON.stringify(f.input)],{cwd:worktree,encoding:'utf8'}));
  assert.ok(out.checks.every((c:any) => c.status === 'ready'), JSON.stringify(out));
  assert.equal(out.workspace,worktree);
  assert.equal(out.index,join(f.root,'.git/worktrees/linked/index'));
  assert.ok(!readdirSync(f.root).includes('UNSAFE_COMMAND'));
  assert.ok(!readdirSync(join(f.root,'.git')).some(n => n.startsWith('sharedindex.')));
});

test('private recovery metadata uses its own index/refs and preserves the host common metadata', t => {
  const f = fixture(t), privateRepo = join(f.root,'private');
  f.git('clone','-q','--no-local','--no-checkout',f.root,privateRepo);
  const metadata = join(privateRepo,'.git'), hostIndex = readFileSync(join(f.root,'.git/index'));
  const out = JSON.parse(execFileSync(process.execPath,['-e',SANDBOX_PROBE_PROGRAM,JSON.stringify(f.input)],{
    cwd:f.root,encoding:'utf8',env:{...process.env,GIT_DIR:metadata,GIT_WORK_TREE:f.root},
  }));
  assert.ok(out.checks.every((c:any) => c.status === 'ready'),JSON.stringify(out));
  assert.equal(out.metadata,metadata); assert.equal(out.index,join(metadata,'index'));
  assert.deepEqual(readFileSync(join(f.root,'.git/index')),hostIndex);
});

test('write/rename failure cleans partial files; teardown facts retain primary failure', async t => {
  const f = fixture(t);
  const script = SANDBOX_PROBE_PROGRAM.replace('fs.renameSync(a,b);',"throw error('EIO'); fs.renameSync(a,b);");
  const report = await probeSandbox({container:'fixture-container',state:f.root,identity:{projectRoot:f.root,runtimeIdentity:'fixture',configIdentity:'fixture',contextFingerprint:'fixture'},invocationId:'test',...f.input},
    async (_cmd,args,o) => realProc(process.execPath,['-e',script,args.at(-1)!],{...o,cwd:f.root}));
  assert.equal(report.status,'blocked');
  assert.ok(report.checks.some(c => c.errno === 'EIO'));
  assert.ok(report.checks.some(c => c.id === 'probe-cleanup' && c.status === 'ready'));
  recordSandboxCleanup(f.root,report,false);
  assert.ok(report.checks.some(c => c.errno === 'EIO'), 'primary probe cause survives');
  assert.ok(report.checks.some(c => c.id === 'container-cleanup' && c.status === 'blocked'));
  assert.ok(!readdirSync(f.root).some(n => n.startsWith('.factory-readiness-')));
});

test('close errors and uncertain exact-container absence are both retained', async () => {
  const calls: string[][] = [];
  const result = await closeSandbox({sandboxId:'fixture-container',close:async () => {throw Error('fixture teardown failed');}},async (_cmd,args) => {
    calls.push(args); return {status:1,stdout:'',stderr:'daemon unavailable'};
  });
  assert.deepEqual(calls,[['container','inspect','fixture-container']]);
  assert.equal(result.confirmed,false);
  assert.match(result.reason!,/fixture teardown failed.*fixture-container.*unconfirmed/);
});

test('missing/changed instructions and probe-cleanup errors cannot report success', t => {
  const f = fixture(t);
  for(const files of [{'missing.md':null},{'required.md':'0'.repeat(64)}]) {
    const out = f.run({files});
    assert.ok(out.checks.some((c:any) => c.operation === 'read-required-file' && c.status === 'blocked'));
  }
  const script = SANDBOX_PROBE_PROGRAM.replace('fs.rmdirSync(p.join(fdPath(o.parent.fd),o.name));',"throw error('EACCES');");
  const out = f.run({},script);
  assert.ok(out.checks.some((c:any) => c.id === 'cleanup-failure' && c.errno === 'EACCES'));
  assert.ok(!out.checks.some((c:any) => c.id === 'probe-cleanup' && c.status === 'ready'));
});
