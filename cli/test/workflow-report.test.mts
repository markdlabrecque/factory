// Workflow diagnostics use disposable Git histories, copied/linked apps and test-owned Unix sockets.
// Recursive byte/mtime snapshots cover reads and exports. No installed app, tracker, service or real Docker access.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { populateCopiedWorkflow } from './copied-workflow-fixture.mts';
import { paths } from '../src/paths.mts';
import { appRoot, buildAssets, writeScaffold } from '../src/scaffold.mts';
import { addProject } from '../src/projects.mts';
import { recordReview, reviewFile } from '../src/recovery-review.mts';
import { writeHistoryCatalog } from '../src/update.mts';
import { capabilityObservations, collectWorkflowReport, configuredImage, formatWorkflowReport, inspectLocalImage, legacyImage, localSocket, workflowDigest } from '../src/workflow-report.mts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@invalid', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe' }).toString().trim();
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'factory-workflow-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const p = paths(join(base, 'home')), source = join(base, 'source'), root = join(base, 'project');
  for (const dir of ['orchestrator', 'board', 'cli/templates', 'cli/src']) cpSync(join(appRoot, dir), join(source, dir), { recursive: true });
  git(source, 'init', '-q'); git(source, 'add', '.'); git(source, 'commit', '-qm', 'v1');
  mkdirSync(root); git(root, 'init', '-q');
  writeScaffold(root, buildAssets({ profile: 'personal', repo: 'test/project', image: 'test/image:local' }, p.state, source));
  populateCopiedWorkflow(root, source);
  addProject(p, root); recordReview(p, root);
  const v1 = git(source, 'rev-parse', 'HEAD');
  // Installed v2 is ahead of the project; the selected source v3 is ahead of both.
  appendFileSync(join(source, 'orchestrator/ci.mts'), '\n// v2\n');
  git(source, 'commit', '-qam', 'v2');
  mkdirSync(p.app, { recursive: true });
  for (const dir of ['orchestrator', 'board', 'cli']) cpSync(join(source, dir), join(p.app, dir), { recursive: true });
  writeHistoryCatalog(source, p.app);
  appendFileSync(join(source, 'orchestrator/graph.mts'), '\n// v3\n');
  git(source, 'commit', '-qam', 'v3');
  const socket = join(base, 'docker.sock');
  const collect = () => collectWorkflowReport(p, { source, projectRoot: root, invokingApp: source, dockerSocket: socket });
  return { base, p, source, root, sc: join(root, '.sandcastle'), v1, socket, collect };
}
function snapshot(root: string): unknown[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).map(e => join(e.parentPath, e.name)).sort().map(path => {
    const st = lstatSync(path);
    return [path.slice(root.length), st.mode, st.mtimeMs, st.isSymbolicLink() ? readlinkSync(path) : st.isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : null];
  });
}
async function socketServer(t: TestContext, path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(path, yes); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server;
}
function child(args: string[], cwd: string, home: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(done => {
    execFile(process.execPath, [join(appRoot, 'cli/bin/factory.mts'), ...args], {
      cwd, env: { ...process.env, HOME: home, FACTORY_HOME: home, ...extraEnv }, timeout: 15000, maxBuffer: 4 << 20,
    }, (error, stdout, stderr) => done({ code: error ? Number(error.code) || 1 : 0, stdout, stderr }));
  });
}

test('source, invoking app, copied app and project identities/classifications are distinct and collection writes nothing', async t => {
  const f = fixture(t);
  appendFileSync(join(f.source, 'orchestrator/graph.mts'), '// dirty\n');
  appendFileSync(join(f.sc, 'tracker.mts'), '// local edit\n');
  appendFileSync(join(f.sc, 'prompt.md'), '\nproject policy\n');
  rmSync(join(f.sc, 'models.mts'));
  writeFileSync(join(f.sc, '.env'), 'SECRET=do-not-report\n');
  writeFileSync(join(f.sc, 'ignored.txt'), 'arbitrary content');
  const before = snapshot(f.base), report = await f.collect();
  assert.equal(report.version, 1);
  assert.equal(report.source.dirty, true);
  assert.match(report.source.commit!, /^[a-f0-9]{40}$/);
  assert.equal(report.invokingApp.canonicalPath, f.source);
  assert.equal(report.installedApp.status, 'copied');
  assert.equal(report.installedApp.commit, null);
  assert.equal(report.projectCopy.commit, null);
  const rows = Object.fromEntries(report.projectCopy.files.map(row => [row.path, row]));
  assert.equal(rows['ci.mts'].againstSource.class, 'outdated');
  assert.equal(rows['ci.mts'].againstInstalled.class, 'outdated');
  assert.equal(rows['graph.mts'].againstSource.class, 'outdated');
  assert.equal(rows['graph.mts'].againstInstalled.class, 'current');
  assert.equal(rows['tracker.mts'].againstSource.class, 'modified');
  assert.equal(rows['prompt.md'].againstSource.class, 'project');
  assert.equal(rows['models.mts'].status, 'missing');
  assert.equal(rows['models.mts'].againstSource.class, 'missing');
  assert.equal(report.installedApp.files.find(row => row.path === 'orchestrator/graph.mts')?.againstSource, 'different');
  assert.equal(report.image.inspection.state, 'unknown');
  assert.equal(report.image.configuration.reference, 'test/image:local');
  const json = JSON.stringify(report), text = formatWorkflowReport(report);
  assert.match(text, /outdated \/ current/);
  assert.match(text, /not establish complete executable compatibility/);
  assert.doesNotMatch(json, /do-not-report|ignored.txt|SECRET|releaseVersion/);
  assert.deepEqual(snapshot(f.base), before);
  assert.equal(workflowDigest(report.source.inventory), workflowDigest([...report.source.inventory].reverse()));
  assert.equal((await f.collect()).source.workflowDigest, report.source.workflowDigest);
  const original = report.source.workflowDigest;
  rmSync(join(f.source, 'orchestrator/graph.mts'));
  const missing = await f.collect();
  assert.notEqual(missing.source.workflowDigest, original);
  assert.equal(missing.source.inventory.find(row => row.path === 'orchestrator/graph.mts')?.status, 'missing');
  assert.equal(missing.projectCopy.files.find(row => row.path === 'graph.mts')?.againstSource.class, 'unknown');
});

test('linked install has real Git identity, copied historical catalog does not; missing app/project stay explicit', async t => {
  const f = fixture(t);
  rmSync(f.p.app, { recursive: true }); symlinkSync(f.source, f.p.app);
  let report = await f.collect();
  assert.equal(report.installedApp.status, 'linked');
  assert.equal(report.installedApp.canonicalPath, f.source);
  assert.equal(report.installedApp.commit, report.source.commit);
  assert.equal(report.installedApp.workflowDigest, report.source.workflowDigest);
  rmSync(f.p.app);
  report = await f.collect();
  assert.equal(report.installedApp.status, 'missing');
  assert.equal(report.installedApp.commit, null);
  assert.equal(report.projectCopy.files[0].againstInstalled.class, 'unknown');
  rmSync(f.root, { recursive: true });
  const before = snapshot(f.base);
  report = await f.collect();
  assert.equal(report.projectCopy.status, 'missing');
  assert.equal(report.capabilities.schedulerCopy.state, 'blocked');
  assert.deepEqual(snapshot(f.base), before);
});

test('content digests ignore Git/state/arbitrary files and absent provenance remains unknown', async t => {
  const f = fixture(t);
  const first = await f.collect();
  writeFileSync(join(f.source, '.env'), 'private');
  writeFileSync(join(f.source, 'orchestrator/not-allowlisted.mts'), 'unrelated');
  assert.equal((await f.collect()).source.workflowDigest, first.source.workflowDigest);
  rmSync(join(f.source, '.git'), { recursive: true });
  const report = await f.collect();
  assert.equal(report.source.commit, null); assert.equal(report.source.dirty, null);
  assert.equal(report.source.workflowDigest, first.source.workflowDigest);
  // Inventory symlinks are not followed, even when they point to a credential-shaped file.
  rmSync(join(f.source, 'orchestrator/graph.mts'));
  symlinkSync('../.env', join(f.source, 'orchestrator/graph.mts'));
  assert.equal((await f.collect()).source.inventory.find(row => row.path.endsWith('/graph.mts'))?.status, 'not-regular');
});

test('existing schedule and recovery observations remain separate, incomplete and malformed states are honest', async t => {
  const f = fixture(t);
  let caps = capabilityObservations(f.p, f.root);
  for (const name of ['schedulerCopy', 'recoveryWorkflow', 'recoveryReview'] as const) assert.equal(caps[name].state, 'met');
  appendFileSync(join(f.sc, 'handoff.mts'), '// helper drift\n');
  caps = capabilityObservations(f.p, f.root);
  assert.equal(caps.schedulerCopy.state, 'met');
  assert.equal(caps.recoveryWorkflow.state, 'met');
  assert.equal(caps.recoveryReview.state, 'blocked');
  assert.deepEqual(caps.recoveryReview.evidence, ['handoff.mts']);
  writeFileSync(reviewFile(f.p, f.root), '{broken');
  assert.equal(capabilityObservations(f.p, f.root).recoveryReview.state, 'unknown');
  writeFileSync(reviewFile(f.p, f.root), JSON.stringify({ version: 1, root: f.root, reviewedAt: 'now', files: { 'handoff.mts': 123 } }));
  assert.equal(capabilityObservations(f.p, f.root).recoveryReview.state, 'unknown');
  rmSync(reviewFile(f.p, f.root));
  assert.match(capabilityObservations(f.p, f.root).recoveryReview.reason, /no recorded/);
  chmodSync(join(f.sc, 'dispatch.sh'), 0o644);
  assert.equal(capabilityObservations(f.p, f.root).schedulerCopy.state, 'blocked');
  writeFileSync(join(f.sc, 'dispatch.mts'), '// lacks reservations'); chmodSync(join(f.sc, 'dispatch.sh'), 0o755);
  assert.equal(capabilityObservations(f.p, f.root).schedulerCopy.state, 'blocked');
  rmSync(join(f.sc, 'handoff.mts'));
  assert.deepEqual(capabilityObservations(f.p, f.root).recoveryWorkflow.evidence, ['handoff.mts']);
  writeFileSync(join(f.sc, 'main.mts'), '// no recovery entrypoint');
  assert.ok(capabilityObservations(f.p, f.root).recoveryWorkflow.evidence.includes('main.mts --recover --attempt-record'));
});

test('invalid, v1 and missing TOML never execute project modules or use legacy image fallback', async t => {
  const f = fixture(t); let requests = 0;
  await socketServer(t, f.socket, (_req, res) => { requests++; res.end('{}'); });
  assert.equal(configuredImage(f.sc).reference, 'test/image:local');
  const marker = join(f.base, 'EXECUTED');
  const sideEffect = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad');\n`;
  writeFileSync(join(f.sc, 'config.mts'), sideEffect + 'throw new Error("must not import config");');
  const original = readFileSync(join(f.sc, 'main.mts'), 'utf8');
  writeFileSync(join(f.sc, 'main.mts'), sideEffect + original);
  const toml = readFileSync(join(f.sc, 'factory.toml'), 'utf8');
  writeFileSync(join(f.sc, 'factory.toml'), '[invalid');
  const before = snapshot(f.base);
  let report = await f.collect();
  assert.equal(report.image.configuration.state, 'invalid-config');
  assert.equal(report.image.configuration.reference, null);
  assert.equal(report.image.inspection.state, 'unknown');
  assert.equal(requests, 0);
  assert.deepEqual(snapshot(f.base), before);
  writeFileSync(join(f.sc, 'factory.toml'), toml.replace('version = 2', 'version = 1'));
  assert.equal(configuredImage(f.sc).reference, null);
  assert.equal(configuredImage(f.sc).state, 'invalid-config');
  rmSync(join(f.sc, 'factory.toml'));
  assert.equal(configuredImage(f.sc).reference, null);
  assert.equal(configuredImage(f.sc).state, 'invalid-config');
  writeFileSync(join(f.sc, 'main.mts'), sideEffect + 'const CONFIG = {image: process.env.IMAGE};');
  report = await f.collect();
  assert.equal(report.image.configuration.state, 'invalid-config');
  assert.equal(requests, 0);
  assert.equal(readdirSync(f.base).includes('EXECUTED'), false);
  for (const text of [
    'const CONFIG = {image: "a", image: "b"};', 'const CONFIG = {image: "a", ...other};',
    'const CONFIG = {[key]: "a", image: "b"};', 'const CONFIG = {image: `dynamic${value}`};',
    'const CONFIG = {image: "a" + other};', 'const CONFIG = {image: "a"}; CONFIG.image = "b";',
    'const CONFIG = {image: "a"}; mutate(CONFIG);', 'const CONFIG = {image: "a"}; CONFIG["image"] = "b";',
    'const CONFIG = {image: "a"}; CONFIG.image ||= "b";', 'const CONFIG = {image: "a"}; delete CONFIG.image;',
    '// const CONFIG = {image: "a"};', 'const CONFIG = getConfig();',
    'const decoy = /const CONFIG = {image: "a"};/;',
    'function decoy() {\n const CONFIG = {image: "a"};\n}',
  ]) assert.equal(legacyImage(text), null, text);
  assert.equal(legacyImage('const CONFIG = {image: "a", sandboxSetup: [{command: "echo image: fake"}]}; const IMAGE = CONFIG.image;'), 'a');
  assert.equal(legacyImage("/* decoy */\nconst CONFIG = { image: 'test:ok' };"), 'test:ok');
});

test('local socket inspection whitelists identity and ignores remote Docker environment', async t => {
  const f = fixture(t); const requests: string[] = [];
  await socketServer(t, f.socket, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.end(JSON.stringify({ Id: 'sha256:local', RepoDigests: ['test/image@sha256:abc'], Os: 'linux', Architecture: 'amd64', Config: { User: '1000', Env: ['SECRET=bad'] }, Labels: { credential: 'bad' }, secret: 'bad' }));
  });
  const oldHost = process.env.DOCKER_HOST, oldContext = process.env.DOCKER_CONTEXT;
  t.after(() => {
    if (oldHost === undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST = oldHost;
    if (oldContext === undefined) delete process.env.DOCKER_CONTEXT; else process.env.DOCKER_CONTEXT = oldContext;
  });
  process.env.DOCKER_HOST = 'tcp://remote.invalid:2375'; process.env.DOCKER_CONTEXT = 'remote';
  const before = snapshot(f.base), report = await f.collect();
  assert.deepEqual(report.image.inspection, { state: 'present', reason: 'local image inspection only', id: 'sha256:local', repoDigests: ['test/image@sha256:abc'], os: 'linux', architecture: 'amd64', user: '1000' });
  assert.deepEqual(requests, ['GET /images/test%2Fimage%3Alocal/json']);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|credential|Labels|Env|"bad"/);
  assert.deepEqual(snapshot(f.base), before);
  assert.match(formatWorkflowReport(report), /ID: sha256:local/);
});

test('local image absence, malformed/error/oversized bodies, deadline and remote socket rejection', async t => {
  const f = fixture(t); let mode = 'missing';
  assert.equal(localSocket(), '/var/run/docker.sock');
  await socketServer(t, f.socket, (_req, res) => {
    if (mode === 'missing') { res.statusCode = 404; res.end('{}'); }
    else if (mode === 'malformed') res.end('{oops');
    else if (mode === 'shape') res.end('{}');
    else if (mode === 'error') { res.statusCode = 500; res.end('secret daemon error'); }
    else if (mode === 'large') res.end('x'.repeat((1 << 20) + 1));
    else if (mode === 'hang') { res.writeHead(200); res.write(' '); }
  });
  assert.equal((await inspectLocalImage('test', f.socket)).state, 'missing');
  for (mode of ['malformed', 'shape', 'error', 'large']) {
    const result = await inspectLocalImage('test', f.socket);
    assert.equal(result.state, 'unknown', mode);
    assert.doesNotMatch(JSON.stringify(result), /secret daemon error/);
    if (mode === 'large') assert.match(result.reason, /exceeds 1 MiB/);
    if (mode === 'malformed' || mode === 'shape') assert.match(result.reason, /malformed/);
  }
  mode = 'hang'; const start = Date.now();
  assert.match((await inspectLocalImage('test', f.socket)).reason, /3-second/);
  assert.ok(Date.now() - start < 4500);
  assert.equal((await inspectLocalImage('test', join(f.base, 'absent.sock'))).state, 'unknown');
  for (const value of ['tcp://host:2375', 'ssh://host/run/docker.sock', 'unix:///tmp/socket', 'relative.sock', '/tmp/http://bad'])
    assert.throws(() => localSocket(value), /absolute local Unix socket/);
});

test('CLI reports text/JSON with exit 0 for drift, resolves current/name/path project, validates flags and writes nothing', async t => {
  const f = fixture(t);
  await socketServer(t, f.socket, (_req, res) => { res.statusCode = 404; res.end('{}'); });
  // Any external executable other than read-only Git is denied. A Git wrapper records and restricts its calls.
  const bin = join(f.base, 'bin'); mkdirSync(bin);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" rev-parse "*|*" log "*|*" status "*) exec ${JSON.stringify(realGit)} "$@";; *) echo 'unapproved Git operation' >&2; exit 98;; esac\n`, { mode: 0o755 });
  for (const name of ['docker', 'gh', 'gh-axi', 'systemctl', 'launchctl', 'op', 'ssh', 'curl']) writeFileSync(join(bin, name), '#!/bin/sh\necho forbidden-boundary >&2\nexit 99\n', { mode: 0o755 });
  const env = { PATH: bin, DOCKER_HOST: 'tcp://remote.invalid:2375', DOCKER_CONTEXT: 'remote' };
  const args = ['workflow', 'status', '--source', f.source, '--docker-socket', f.socket];
  const before = snapshot(f.base);
  for (const project of [[], ['--project', 'project'], ['--project', f.root]]) {
    const result = await child([...args, ...project, '--json'], f.root, f.p.home, env);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.version, 1); assert.equal(report.projectCopy.root, f.root);
    assert.equal(report.image.inspection.state, 'missing');
  }
  const text = await child(args, f.root, f.p.home, env);
  assert.equal(text.code, 0, text.stderr); assert.match(text.stdout, /schema version 1/);
  const help = await child(['workflow', '--help'], f.root, f.p.home, env);
  assert.equal(help.code, 0); assert.match(help.stdout, /workflow status --source/);
  for (const bad of [ ['workflow'], ['workflow', 'repair', '--source', f.source], ['workflow', 'status'],
    ['workflow', 'status', '--source', '/nonexistent-source'], [...args, 'extra'], [...args, '--apply'],
    [...args, '--project', 'unregistered'], ['workflow', 'status', '--source', f.source, '--docker-socket', 'tcp://remote'] ]) {
    const result = await child(bad, f.root, f.p.home, env); assert.equal(result.code, 1, `${bad}: ${result.stdout}`);
  }
  const unregistered = await child(args, f.base, f.p.home, env); assert.equal(unregistered.code, 1);
  assert.match(unregistered.stderr, /not a registered project/);
  assert.deepEqual(snapshot(f.base), before);
  writeFileSync(join(f.sc, 'factory.toml'), 'invalid');
  const invalid = await child([...args, '--json'], f.root, f.p.home, env);
  assert.equal(invalid.code, 0, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).image.configuration.state, 'invalid-config');
  rmSync(f.root, { recursive: true });
  const missingProject = await child([...args, '--project', 'project', '--json'], f.base, f.p.home, env);
  assert.equal(missingProject.code, 0, missingProject.stderr);
  assert.equal(JSON.parse(missingProject.stdout).projectCopy.status, 'missing');
});


test('data-only workflow report is complete and does not advise executable repair', async t => {
  const f = fixture(t);
  rmSync(f.sc, { recursive: true });
  writeScaffold(f.root, buildAssets({ profile: 'personal', repo: 'test/project', image: 'test/image:local' }, f.p.state, f.source));
  const before = snapshot(f.base), report = await f.collect();
  assert.ok(report.projectCopy.files.every(row => row.againstSource && row.againstInstalled));
  assert.doesNotMatch(JSON.stringify(report), /would create|would replace/);
  assert.doesNotMatch(formatWorkflowReport(report), /would create|would replace/);
  assert.deepEqual(snapshot(f.base), before);
});
