// Readiness diagnostics and documented CLI/JSON examples use temporary projects and fake runtime dependencies.
// External commands are trapped or absent; only fixture-local Git and Node children are permitted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { factoryToml } from './config-fixture.mts';
import { bindExecution } from './execution-fixture.mts';
import { diagnosticInput } from '../src/readiness.mts';
import { collectReadiness, projectKey } from '../../orchestrator/readiness.mts';
import { beginReadiness, publishReadiness } from '../../board/readiness.mts';
import { status } from '../src/commands/status.mts';
import { doctor } from '../src/commands/doctor.mts';
import { freezeTicketInput, saveTicketInput } from '../../orchestrator/ticket-input.mts';
import { ticketShow } from '../src/commands/ticket.mts';
function fixture(t: any) {
  const home = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'cli-readiness-'))), p = paths(home), root = join(home, 'project with spaces');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previous = process.env.SANDCASTLE_STATE_DIR;
  process.env.SANDCASTLE_STATE_DIR = p.state;
  t.after(() => { if (previous === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = previous; });
  fs.mkdirSync(join(root, '.sandcastle'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(join(root, '.sandcastle/factory.toml'), factoryToml('me/project'));
  // Executable overrides must never be imported by diagnostics.
  fs.writeFileSync(join(root, '.sandcastle/config.mts'), 'throw Error("EXECUTABLE IMPORTED");');
  addProject(p, root); fs.mkdirSync(p.state, { recursive: true });
  bindExecution(root, {}, { paths: p, overlays: false });
  const output: string[] = []; t.mock.method(console, 'log', (s: string) => output.push(s));
  const out = () => { const text = output.join('\n'); output.length = 0; return text; };
  const save = (mutate = (_r: any) => {}) => {
    const input = diagnosticInput(p, root), token = beginReadiness(p.state, input.identity, input.owner);
    const report = collectReadiness({ ...input, owner: token.owner }, 'passive');
    mutate(report); assert.equal(publishReadiness(p.state, token, report), true); return report;
  };
  return { p, root, out, save };
}
const board = { status: async () => 'inactive' };
test('readiness guide commands, JSON subsets, selectors and exit semantics match isolated CLI results', t => {
  const f = fixture(t);
  const docs = fs.readFileSync(new URL('../../docs/factory-cli.md', import.meta.url), 'utf8');
  const block = (label: string, language: string) => {
    const match = docs.match(new RegExp(`<!-- ${label} -->\\s*\x60\x60\x60${language}\\n([\\s\\S]*?)\x60\x60\x60`));
    assert.ok(match, label); return match[1].trim();
  };
  // No inherited PATH, auth, provider or service environment. Git can only inspect this disposable checkout.
  const bin = join(f.p.home, 'fixture-bin'); fs.mkdirSync(bin); fs.symlinkSync('/usr/bin/git', join(bin, 'git'));
  const cli = (args: string[], cwd = f.p.home) => childProcess.spawnSync(process.execPath,
    [join(import.meta.dirname, '../bin/factory.mts'), ...args], { cwd, encoding: 'utf8',
      env: { HOME: f.p.home, FACTORY_HOME: f.p.home, SANDCASTLE_STATE_DIR: f.p.state, PATH: bin, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  const subset = (actual: any, expected: any) => {
    for (const [key, value] of Object.entries(expected)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) subset(actual[key], value);
      else assert.deepEqual(actual[key], value, key);
    }
  };
  const results = block('readiness-command-fixture', 'sh').split('\n').map(line => {
    const words = line.match(/"[^"]*"|\S+/g)!.map(word => word.replace(/^"|"$/g, ''));
    assert.equal(words.shift(), 'factory');
    const result = cli(words); assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  });
  assert.equal(results.length, 4);
  subset(results[0], JSON.parse(block('readiness-passive-json', 'json')));
  assert.equal(results[1].readiness.state, 'missing'); assert.deepEqual(results[1].runs, []);
  subset(results[2], JSON.parse(block('readiness-ticket-json', 'json')));
  subset(results[3], JSON.parse(block('readiness-active-json', 'json')));
  assert.equal(fs.existsSync(join(f.p.state, 'readiness')), false, 'doctor must not publish');
  assert.deepEqual(fs.readdirSync(join(f.root, '.sandcastle/evidence')), []);
  for (const selector of [f.root, join(f.root, '.sandcastle')]) {
    const result = cli(['doctor', '--project', selector, '--json']);
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).project.root, f.root);
  }
  const implicit = cli(['doctor', '--json'], f.root);
  assert.equal(implicit.status, 0, implicit.stderr); assert.equal(JSON.parse(implicit.stdout).project.root, f.root);
  for (const args of [['doctor', '--project', 'not registered', '--json'], ['doctor', 'unexpected', '--project', 'project with spaces']]) {
    const result = cli(args); assert.equal(result.status, 1); assert.ok(result.stderr); assert.equal(result.stdout, '');
  }
  fs.rmdirSync(join(f.root, '.sandcastle/evidence'));
  fs.symlinkSync(f.p.state, join(f.root, '.sandcastle/evidence'));
  const failed = cli(['doctor', '--project', 'project with spaces', '--probe-filesystem', '--json']);
  assert.equal(failed.status, 1); const failure = JSON.parse(failed.stdout).readiness.report;
  assert.equal(failure.status, 'blocked'); assert.ok(failure.checks.some((c: any) => c.id === 'evidence' && c.errno === 'EUNSAFEPATH'));
  f.save(r => { r.status = 'blocked'; r.checks[0] = { ...r.checks[0], status: 'blocked', errno: 'EACCES' }; });
  for (const args of [['status'], ['ticket', 'show', '7']]) {
    const result = cli([...args, '--project', 'project with spaces', '--json']);
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).readiness.report.status, 'blocked');
  }
});
test('doctor CLI accepts explicit project/probe/json and rejects stray positionals before writing', t => {
  const f = fixture(t);
  const cli = (...args: string[]) => childProcess.spawnSync(process.execPath, [join(import.meta.dirname, '../bin/factory.mts'), 'doctor', ...args],
    { cwd: f.p.home, env: { ...process.env, FACTORY_HOME: f.p.home, PATH: '' }, encoding: 'utf8' });
  const passive = cli('--project', 'project with spaces', '--json');
  assert.equal(passive.status, 0, passive.stderr); assert.equal(JSON.parse(passive.stdout).writeCapability, 'untested');
  assert.equal(fs.existsSync(join(f.root, '.sandcastle/logs')), false);
  const bad = cli('unexpected', '--project', 'project with spaces', '--probe-filesystem');
  assert.equal(bad.status, 1); assert.match(bad.stderr, /Unexpected arguments/);
  assert.equal(fs.existsSync(join(f.root, '.sandcastle/logs')), false);
  const active = cli('--project', 'project with spaces', '--probe-filesystem', '--json');
  assert.equal(active.status, 0, active.stderr); assert.equal(JSON.parse(active.stdout).readiness.report.phase, 'active');
});
test('zero-run project hold is shown once above runs; JSON contains no prose', async t => {
  const f = fixture(t);
  f.save(r => { r.status = 'blocked'; r.checks[0] = { ...r.checks[0], status: 'blocked', operation: 'open-read', errno: 'EACCES', reason: 'Required read failed', nextActor: 'operator', nextAction: 'Inspect read access' }; });
  await status(f.p, board, { project: f.root });
  const text = f.out();
  assert.match(text, /Current project readiness: blocked/); assert.match(text, /open-read .*project with spaces.*EACCES/);
  assert.match(text, /Next actor: operator/); assert.match(text, /Automatic recheck: next-launch/);
  assert.equal(text.match(/Current project readiness:/g)?.length, 1); assert.match(text, /No runs yet/);
  await status(f.p, board, { project: f.root, json: true });
  const data = JSON.parse(f.out()); assert.equal(data.version, 1); assert.equal(data.readiness.report.status, 'blocked'); assert.deepEqual(data.runs, []);
});
test('explicit ticket attribution shows only applicable holds, including tickets without runs', async t => {
  const f = fixture(t);
  f.save(r => {
    r.checks = r.checks.filter((c: any) => c.status === 'ready');
    const base = r.checks[0];
    r.checks.push({ ...base, id: 'parent-notes', scope: 'ticket-input', ticket: '10', status: 'blocked', operation: 'notes', reason: 'Required parent notes unavailable' },
      { ...base, id: 'branch-conflict', scope: 'ticket-workspace', ticket: '11', status: 'blocked', operation: 'worktree-registration', reason: 'Branch conflict' });
    r.status = 'blocked';
  });
  await status(f.p, board, { project: f.root });
  const text = f.out(); assert.match(text, /Current project readiness: ready/); assert.match(text, /ticket #10/); assert.match(text, /ticket #11/);
  ticketShow(f.p, '10', { project: f.root, json: true });
  const ticket = JSON.parse(f.out()); assert.equal(ticket.readiness.report.status, 'ready');
  assert.deepEqual(ticket.ticketReadiness.report.checks.map((c: any) => c.ticket), ['10']);
  assert.equal(ticket.input.readiness.report.status, 'blocked'); assert.equal(ticket.run, undefined);
  assert.doesNotMatch(JSON.stringify(ticket), /branch-conflict/);
});
test('ticket show reads the frozen input producer by execution identity without tracker or log reads', t => {
  const f = fixture(t), at = new Date().toISOString();
  const input = freezeTicketInput({identity:{kind:'github',host:'github.test',project:'me/project'},
    ticket:iid=>({bytes:1,value:{iid,title:'Full specification',description:'Task data must not be exposed in passive metadata',url:`https://github.test/me/project/issues/${iid}`}}),
    parentOf:()=>({bytes:1,value:null}),notes:()=>({bytes:1,value:{notes:[],nextPage:null}})},7);
  saveTicketInput(join(f.p.state,'ticket-inputs','me_project--7','execution'),input);
  const run = {iid:'7',project:'me/project',executionId:'execution',stage:'implementing',startedAt:at,updatedAt:at,stageSince:at,pid:process.pid,
    evidenceDir:'/must-not-read-logs',ticketInput:{hash:input.hash,renderedSha256:input.textHash}};
  const file = join(f.p.state,'me_project--7.json'); fs.writeFileSync(file,JSON.stringify(run));
  ticketShow(f.p,'7',{project:f.root,json:true,exec:()=>{throw Error('tracker forbidden');}});
  const data = JSON.parse(f.out()); assert.equal(data.input.state,'frozen'); assert.equal(data.input.contentHash,input.hash);
  assert.equal(data.input.renderedSha256,input.textHash); assert.equal(data.input.coverage.length,3);
  assert.equal(data.input.references[0].iid,7); assert.match(data.input.reason,/current tracker freshness is not checked/);
  assert.doesNotMatch(JSON.stringify(data.input),/Task data must not be exposed/);
  fs.writeFileSync(file,JSON.stringify({...run,executionId:'different-execution'}));
  ticketShow(f.p,'7',{project:f.root,json:true}); assert.equal(JSON.parse(f.out()).input.state,'unknown','never reuse another execution snapshot');
});

test('missing, pending, invalid and stale reports never claim current ready', async t => {
  const f = fixture(t);
  const read = async () => { await status(f.p, board, { project: f.root, json: true }); return JSON.parse(f.out()).readiness; };
  assert.equal((await read()).state, 'missing');
  const input = diagnosticInput(f.p, f.root); beginReadiness(f.p.state, input.identity, input.owner);
  assert.equal((await read()).state, 'pending');
  const file = join(f.p.state, 'readiness', `${projectKey(f.root)}.json`);
  fs.writeFileSync(file, 'not JSON'); assert.equal((await read()).state, 'invalid');
  f.save(r => { r.observedAt = '2000-01-01T00:00:00Z'; }); assert.equal((await read()).state, 'stale');
});
test('passive status, ticket show and doctor do not mutate, read secrets or call processes/network', async t => {
  const f = fixture(t); f.save();
  const report = join(f.p.state, 'readiness', `${projectKey(f.root)}.json`), before = fs.readFileSync(report);
  const forbidden = () => { throw Error('Forbidden external operation or mutation'); };
  for (const name of ['writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'chmodSync', 'chownSync'] as const) t.mock.method(fs, name, forbidden);
  for (const name of ['execFileSync', 'execSync', 'spawn', 'spawnSync', 'exec', 'execFile'] as const) t.mock.method(childProcess, name, forbidden);
  t.mock.method(globalThis, 'fetch', forbidden);
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (path: any, ...args: any[]) => {
    assert.doesNotMatch(String(path), /(?:\.env|auth\.json|implementer\.log)$/); return (read as any)(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await status(f.p, board, { project: 'project with spaces', json: true }); JSON.parse(f.out());
  assert.equal(ticketShow(f.p, '10', { project: 'project with spaces', json: true }), 0);
  const ticket = JSON.parse(f.out()); assert.equal(ticket.input.state, 'unknown'); assert.equal(ticket.executionReadiness.state, 'unknown');
  assert.equal(await doctor(f.p, undefined, { project: 'project with spaces', json: true }), 0);
  const data = JSON.parse(f.out()); assert.equal(data.writeCapability, 'untested'); assert.equal(data.readiness.report.phase, 'passive');
  assert.deepEqual(fs.readFileSync(report), before);
  assert.equal(fs.existsSync(join(f.root, '.sandcastle/logs')), false);
  t.mock.restoreAll(); syncBuiltinESMExports();
});
test('only matching recent active write cycles establish an observed write capability, never passive overwrites', async t => {
  const f = fixture(t), input = diagnosticInput(f.p, f.root);
  const token = beginReadiness(f.p.state, input.identity, input.owner);
  const report = collectReadiness({ ...input, owner: token.owner }, 'active');
  assert.equal(publishReadiness(f.p.state, token, report), true);
  const file = join(f.p.state, 'readiness', `${projectKey(f.root)}.json`), before = fs.readFileSync(file);
  assert.equal(await doctor(f.p, undefined, { project: 'project with spaces', json: true }), 0);
  const data = JSON.parse(f.out()); assert.equal(data.writeCapability, 'observed recently, not authorization');
  assert.equal(data.readiness.report.phase, 'passive'); assert.deepEqual(fs.readFileSync(file), before);
  fs.writeFileSync(join(f.root, '.sandcastle/factory.toml'), factoryToml('me/project') + '\n# changed identity\n');
  assert.equal(await doctor(f.p, undefined, { project: 'project with spaces', json: true }), 0);
  assert.equal(JSON.parse(f.out()).writeCapability, 'untested'); assert.deepEqual(fs.readFileSync(file), before);
});
test('default installation doctor keeps project observations passive with fake prerequisite/service boundaries', async t => {
  const f = fixture(t), calls: string[] = [];
  t.mock.method(childProcess, 'execFileSync', (command: string, args: string[]) => {
    calls.push([command, ...args].join(' '));
    if (command === 'test' && args[0] === '-x') return '';
    if (command === 'git' && JSON.stringify(args) === JSON.stringify(['-C', f.root, 'rev-parse', '--show-toplevel'])) return f.root;
    if (command === 'systemctl' && JSON.stringify(args) === JSON.stringify(['--user', 'show-environment'])) return '';
    if (command === 'loginctl' && args[0] === 'show-user' && args.slice(2).join(' ') === '--property=Linger --value') return 'yes';
    if (command === 'launchctl' && args[0] === 'print' && args.length === 2) return '';
    throw Error(`Unexpected external operation: ${command}`);
  });
  t.mock.method(globalThis, 'fetch', async (url: any) => { assert.equal(url, 'http://127.0.0.1:4444'); return { ok: true }; });
  for (const name of ['writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'chmodSync', 'chownSync'] as const)
    t.mock.method(fs, name, () => { throw Error('Passive mutation'); });
  syncBuiltinESMExports();
  try {
    assert.equal(await doctor(f.p, undefined, { cwd: f.root }), 1, 'missing installation manifest still fails as before');
    const text = f.out(); assert.match(text, /Filesystem observation: unknown \| passive/); assert.match(text, /Write capability: untested/);
    assert.equal(fs.existsSync(join(f.root, '.sandcastle/logs')), false);
    assert.ok(calls.length); assert.ok(calls.every(c => !/docker (?:run|start)|\b(?:op|pi|claude|gh|glab) /.test(c)));
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
test('explicit active doctor performs owned probes, does not publish, and failure is operation-specific', async t => {
  const f = fixture(t);
  assert.equal(await doctor(f.p, undefined, { project: f.root, probeFilesystem: true, json: true }), 0);
  const data = JSON.parse(f.out()); assert.equal(data.writeCapability, 'ready');
  assert.deepEqual(fs.readdirSync(join(f.root, '.sandcastle/logs')), []);
  assert.equal(fs.existsSync(join(f.p.state, 'readiness')), false);
  fs.rmdirSync(join(f.root, '.sandcastle/logs')); fs.symlinkSync(f.p.state, join(f.root, '.sandcastle/logs'));
  assert.equal(await doctor(f.p, undefined, { project: f.root, probeFilesystem: true, json: true }), 1);
  const failed = JSON.parse(f.out()).readiness.report.checks.find((c: any) => c.id === 'logs');
  assert.equal(failed.status, 'blocked'); assert.equal(failed.errno, 'EUNSAFEPATH'); assert.equal(failed.operation, 'lstat'); assert.match(failed.nextAction, /Inspect lstat/);
});
test('ticket show separates current hold and historical stopped execution without opening log bodies', t => {
  const f = fixture(t); f.save();
  const at = new Date().toISOString();
  fs.writeFileSync(join(f.p.state, 'me_project--10.json'), JSON.stringify({ project: 'me/project', iid: '10', stage: 'stopped', startedAt: at, note: 'Historical agent stopped', pid: 999999 }));
  ticketShow(f.p, '10', { project: f.root, json: true });
  const data = JSON.parse(f.out()); assert.equal(data.executionReadiness.stage, 'stopped'); assert.equal(data.executionReadiness.note, 'Historical agent stopped'); assert.ok(data.readiness); assert.equal(data.input.contentHash, null);
});
