// Offline Board readiness fixtures. Production routing is invoked in memory, never a listening endpoint.
// All registry/state/project bytes are temporary; process, probe, tracker and write boundaries are trapped on GET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { buildReadinessData } from './readiness-view.mts';
import { beginReadiness, publishReadiness, readReadiness, readStoredReadiness } from './readiness.mts';
import { projectKey, validReport } from '../orchestrator/readiness-schema.mts';
import { buildPage } from './board.mts';
import { handleRequest } from './board-server.mts';
import type { ReadinessCheck, ReadinessReport } from '../orchestrator/readiness-schema.mts';

function fixture(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'board-readiness-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = join(root, 'state'), project = join(root, 'project'), other = join(root, 'other');
  for (const path of [state, project, other, join(root, '.config'), join(root, '.config/factory')]) fs.mkdirSync(path);
  const registry = join(root, '.config/factory/projects.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, projects: [{ name: 'project', root: project }, { name: 'other', root: other }] }));
  const now = Date.parse('2026-11-15T12:00:00Z');
  const check: ReadinessCheck = { id: 'state', scope: 'project', phase: 'active', observedAt: new Date(now).toISOString(), status: 'blocked', required: true,
    operation: 'rename', path: join(project, 'path with spaces'), errno: 'EACCES', reason: 'Access denied', nextActor: 'operator', nextAction: 'Inspect access to this path', automaticRecheck: 'next-launch' };
  function publish(checks = [check], target = project) {
    const identity = { projectRoot: target, runtimeIdentity: 'runtime-a', configIdentity: 'config-a', contextFingerprint: 'context-a' };
    const token = beginReadiness(state, identity, { invocationId: 'invocation', ownerId: 'owner' });
    const report: ReadinessReport = { version: 1, identity, owner: token.owner, observedAt: new Date(now).toISOString(), phase: 'active',
      status: checks.some(c => c.required && c.status === 'blocked') ? 'blocked' : checks.some(c => c.required && c.status === 'unknown') || !checks.length ? 'unknown' : 'ready', checks };
    assert.ok(publishReadiness(state, token, report)); return report;
  }
  return { root, state, project, other, registry, now, check, publish };
}
class Element {
  children: Element[] = []; dataset: Record<string, string> = {}; text = '';
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  set textContent(v: string) { this.text = v; this.children = []; }
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join('\n'); }
  set innerHTML(_: string) { assert.fail('Untrusted readiness must be plain text'); }
  appendChild(n: Element) { this.children.push(n); return n; }
  replaceChildren(...nodes: Element[]) { this.text = ''; this.children = nodes; }
}
const template = fs.readFileSync(resolve('board/board.template.html'), 'utf8');
function renderer() {
  const code = template.split('// readiness-render:start')[1].split('// readiness-render:end')[0];
  return runInNewContext(code + '\npaintReadiness', {
    time: Date.parse,
    el: (tag: string, _cls?: string, text?: string) => { const n = new Element(tag); if (text !== undefined) n.textContent = text; return n; },
    add: (p: Element, ...nodes: Element[]) => nodes.forEach(n => p.appendChild(n)),
  });
}

test('zero-run registry projection, project and explicit ticket scopes, unknown/stale and later ready DOM', t => {
  const f = fixture(t), paint = renderer(), node = new Element('section');
  const hostile = '</script><img src=x onerror=alert(1)>';
  f.publish([f.check, { ...f.check, id: 'input', scope: 'ticket-input', ticket: '42', operation: 'parent.comments', path: '', reason: hostile },
    { ...f.check, id: 'unattributed', scope: 'ticket-workspace', path: '', reason: 'No ticket attribution' }]);
  const snapshot = buildReadinessData(f.state, f.registry, f.now);
  assert.equal(snapshot.projects.length, 2);
  assert.equal(snapshot.projects[1].observation.state, 'missing');
  paint(node, snapshot, '', f.now);
  assert.equal(node.textContent.split('Project observation: blocked').length - 1, 1);
  assert.equal(node.textContent.split('Ticket #42').length - 1, 1);
  assert.match(node.textContent, /Unattributed ticket\/sandbox check \(not a project hold\)/);
  assert.match(node.textContent, /rename.*path with spaces.*EACCES/);
  assert.match(node.textContent, /parent.comments/);
  assert.ok(node.textContent.includes(hostile));
  assert.match(node.textContent, /Next actor: operator.*Inspect access.*Automatic recheck: next-launch/);
  assert.match(node.textContent, /runtime-a.*config-a.*context-a/);
  paint(node, snapshot, 'other', f.now);
  assert.doesNotMatch(node.textContent, /Ticket #42|EACCES/);
  paint(node, snapshot, 'project', f.now + 60_001);
  assert.match(node.textContent, /unknown \(stale observation, previously blocked\)/);
  f.publish([{ ...f.check, status: 'ready', errno: undefined }]);
  paint(node, buildReadinessData(f.state, f.registry, f.now), '', f.now);
  assert.match(node.textContent, /Project observation: ready/);
  assert.doesNotMatch(node.textContent, /Ticket #42|EACCES|Project observation: blocked/);
  // Ticket failure cannot masquerade as a shared project failure.
  f.publish([{ ...f.check, status: 'ready', errno: undefined }, { ...f.check, scope: 'ticket-workspace', ticket: '43' }]);
  paint(node, buildReadinessData(f.state, f.registry, f.now), '', f.now);
  assert.match(node.textContent, /Project observation: ready/);
  assert.match(node.textContent, /Ticket #43/);
  assert.doesNotMatch(node.textContent, /Project observation: blocked/);
});

test('unknown, empty and pending reports cannot become healthy; registry bounds fail closed', t => {
  const f = fixture(t), paint = renderer(), node = new Element('section');
  for (const checks of [[], [{ ...f.check, status: 'unknown' as const }]]) {
    f.publish(checks);
    paint(node, buildReadinessData(f.state, f.registry, f.now), 'project', f.now);
    assert.match(node.textContent, /Project observation: unknown/);
    assert.doesNotMatch(node.textContent, /Project observation: ready/);
  }
  beginReadiness(f.state, { projectRoot: f.project, runtimeIdentity: 'b', configIdentity: 'b', contextFingerprint: 'b' }, { invocationId: 'new', ownerId: 'new' });
  paint(node, buildReadinessData(f.state, f.registry, f.now), 'project', f.now);
  assert.match(node.textContent, /unknown \(pending\)/);
  fs.writeFileSync(f.registry, 'x'.repeat(256 * 1024 + 1));
  assert.match(buildReadinessData(f.state, f.registry, f.now).reason!, /unknown/);
  fs.unlinkSync(f.registry); fs.symlinkSync(join(f.root, 'secret'), f.registry);
  assert.match(buildReadinessData(f.state, f.registry, f.now).reason!, /unknown/);
});

test('same shared validator rejects invalid attribution, cross-root envelopes, malformed, escaping and symlink stores', t => {
  const f = fixture(t), report = f.publish();
  for (const ticket of ['../42', '0', '1/2', 42]) assert.equal(validReport({ ...report, checks: [{ ...f.check, scope: 'ticket-input', ticket }] }), false);
  assert.equal(validReport({ ...report, checks: [{ ...f.check, ticket: '42' }] }), false);
  const file = join(f.state, 'readiness', projectKey(f.project) + '.json');
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(join(f.state, 'readiness', projectKey(f.other) + '.json'), bytes);
  assert.equal(readStoredReadiness(f.state, f.other, f.now).state, 'invalid');
  assert.equal(readReadiness(f.state, { ...report.identity, projectRoot: f.other }, f.now).state, 'invalid');
  assert.equal(readStoredReadiness(f.state, f.project + '/../other', f.now).state, 'invalid');
  fs.writeFileSync(file, '{}');
  const paint = renderer(), node = new Element('section');
  paint(node, buildReadinessData(f.state, f.registry, f.now), '', f.now);
  assert.match(node.textContent, /unknown \(invalid\)/);
  fs.unlinkSync(file); fs.symlinkSync(join(f.root, 'secret'), file);
  assert.equal(readStoredReadiness(f.state, f.project, f.now).state, 'invalid');
  fs.writeFileSync(f.registry, JSON.stringify({ version: 1, projects: [{ name: 'bad', root: f.project + '/../other' }] }));
  assert.match(buildReadinessData(f.state, f.registry, f.now).reason!, /unknown/);
});

function request(url: string, method = 'GET') {
  let code = 0, body = ''; const headers: Record<string, string> = {};
  handleRequest({ url, method, headers: {} } as any, {
    setHeader: (k: string, v: string) => { headers[k] = v; },
    writeHead: (c: number, h: Record<string, string>) => { code = c; Object.assign(headers, h); },
    end: (v: string) => { body = v; },
  } as any);
  return { code, body, headers };
}

test('production GET routing is passive, path-independent and compatible; file snapshots embed escaped timestamped readiness', t => {
  const f = fixture(t);
  const oldState = process.env.SANDCASTLE_STATE_DIR, oldHome = process.env.FACTORY_HOME;
  process.env.SANDCASTLE_STATE_DIR = f.state; process.env.FACTORY_HOME = f.root;
  t.after(() => { if (oldState === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = oldState;
    if (oldHome === undefined) delete process.env.FACTORY_HOME; else process.env.FACTORY_HOME = oldHome; });
  f.publish([{ ...f.check, reason: '</script><script>credential-bearing-command</script>' }]);
  // Several parked cards and an old stop retain historical facts; no duplicate readiness labels/cards are made.
  for (const iid of ['1', '2', '3']) fs.writeFileSync(join(f.state, `project--${iid}.json`), JSON.stringify({ iid, project: 'project', stage: iid === '3' ? 'stopped' : 'queued', pid: 99999999,
    title: 'Old history', note: 'historical execution note', startedAt: new Date(f.now - 100000).toISOString(), stageSince: new Date(f.now - 100000).toISOString() }));
  // A dead unfinished run used to be rewritten by a GET. Its log path must never be read either.
  fs.writeFileSync(join(f.state, 'project--4.json'), JSON.stringify({ iid: '4', project: 'project', stage: 'implementing', pid: 99999999, branch: 'unsafe', evidenceDir: join(f.project, '.factory/evidence/4'), startedAt: new Date(f.now).toISOString() }));
  const before = fs.readdirSync(f.state).filter(n => n.endsWith('.json')).map(n => [n, fs.readFileSync(join(f.state, n), 'utf8')]);
  const originals: [any, string, any][] = [];
  function trap(object: any, key: string) { originals.push([object, key, object[key]]); object[key] = () => assert.fail('Unexpected GET boundary: ' + key); }
  try {
    for (const key of ['writeFileSync', 'writeSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync', 'appendFileSync']) trap(fs, key);
    trap(globalThis, 'fetch');
    const open = fs.openSync;
    originals.push([fs, 'openSync', open]);
    fs.openSync = ((path: any, flags: any, ...args: any[]) => {
      assert.ok(!String(path).startsWith(f.project), 'GET must not inspect project paths');
      assert.ok(!String(path).includes('/logs/'), 'GET must not inspect log paths');
      if (typeof flags === 'string') assert.equal(flags, 'r');
      else assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC), 0);
      return (open as any)(path, flags, ...args);
    }) as any;
    for (const key of ['execFileSync', 'execSync', 'spawn', 'spawnSync', 'execFile', 'exec']) trap(cp, key);
    const read = fs.readFileSync;
    originals.push([fs, 'readFileSync', read]);
    fs.readFileSync = ((path: any, ...args: any[]) => { assert.ok(!String(path).includes('/logs/')); assert.ok(!String(path).startsWith(f.project)); return (read as any)(path, ...args); }) as any;
    syncBuiltinESMExports();
    const readiness = request('/api/readiness?root=/etc&project=../../secret');
    assert.equal(readiness.code, 200); assert.equal(readiness.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(readiness.body).projects.length, 2);
    const runs = request('/api/runs');
    const data = JSON.parse(runs.body);
    assert.ok(Array.isArray(data.runs)); assert.equal(data.runs.length, 4); assert.equal(data.readiness, undefined);
    assert.equal(data.runs.filter((r: any) => r.stage === 'stopped').length, 1);
    assert.doesNotMatch(runs.body, /EACCES|credential-bearing-command/);
    assert.equal(request('/api/readiness/../../secret').code, 404);
    assert.equal(request('/api/readiness', 'POST').code, 405);
    const page = buildPage('file');
    const embedded = JSON.parse(page.split('/*__DATA__*/')[0].split('<script id="data" type="application/json">')[1].split('</script>')[0]);
    assert.ok(embedded.readiness.generatedAt); assert.equal(embedded.readiness.projects.length, 2);
    assert.ok(page.includes('\\u003c/script>')); assert.ok(!page.includes('</script><script>credential-bearing-command'));
    assert.equal(request('/').code, 200);
  } finally { for (const [object, key, value] of originals.reverse()) object[key] = value; syncBuiltinESMExports(); }
  for (const [name, bytes] of before) assert.equal(fs.readFileSync(join(f.state, name), 'utf8'), bytes);
  assert.equal(fs.readdirSync(f.state).filter(n => n.endsWith('.json')).length, 4);
  const start = template.split('function startBoard()')[1].split('// ---------- evidence ----------')[0];
  assert.ok(start.indexOf('if (fileMode || !shouldPoll') < start.indexOf('startReadiness();'));
  assert.match(start, /url: '\/api\/readiness', interval: 10000/);
  assert.match(start, /isHidden: function \(\) \{ return document.visibilityState === 'hidden'; \}/);
});
