// Refresh process ownership, fencing, admission and preservation races.
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

test("manual worker has a bounded process group and coalesces overlapping requests per card", async (t) => {
  const f = fixture(t), record = f.record(7, "stopped");
  // A deliberately hung project command, not a tracker/agent. It stands in for an adapter blocked in network I/O.
  writeFileSync(join(f.root, ".factory/dispatch.mts"), `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.FAKE_STATE + '/hung-command', String(process.pid) + '\\n');\nawait new Promise(r => setTimeout(r, 60000));\n`);
  const env = { ...process.env };
  const hung = bindExecution(f.root, f.env);
  for (const [key, value] of Object.entries(hung.env)) if (value !== undefined) process.env[key] = value;
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
  requestRefresh(f.dir, f.key(7), "7", "owner/repo");
  const a = readAssessment(f.dir, f.key(7))!;
  const { writeAssessment } = await import("../board/assessment.mts");
  writeAssessment(f.dir, f.key(7), { ...a, projectRoot: f.root });
  const { executeRefresh } = await import("../board/refresh-worker.mts");
  const first = executeRefresh(f.key(7), 200), second = executeRefresh(f.key(7), 200);
  assert.equal(first, second, "same card shares its in-flight worker");
  await first;
  assert.match(f.assessment().error!, /timed out/);
  assert.equal(f.assessment().pending, false);
  const pids = f.bytes(join(f.fake, "hung-command")).trim().split("\n");
  assert.equal(pids.length, 1);
  assert.throws(() => process.kill(Number(pids[0]), 0));
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
});

test('a running dispatcher keeps bundle A for detached children after descriptor B publication', async t => {
  const f = fixture(t), gate = join(f.fake, 'replacement-gate');
  f.data.tickets = [ticket(7, { description: 'Implement this change' })]; f.save();
  writeFileSync(join(f.home, 'bin/pi'), `#!/bin/sh\ntouch '${gate}.ready'\nwhile [ ! -f '${gate}.release' ]; do sleep 0.02; done\nexec '${f.node}' '${join(FIXTURES, 'refresh-analysis.mjs')}' "$@"\n`, { mode: 0o755 });
  const child = spawn(f.node, [join(f.runtime.directory, 'dispatch.mts'), '--base', 'main'], { cwd: f.root, env: f.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', s => { output += s; }); child.stderr.on('data', s => { output += s; });
  const finished = once(child, 'close');
  t.after(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} });
  const deadline = Date.now() + 10000;
  while (!existsSync(`${gate}.ready`) && child.exitCode === null && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
  assert.ok(existsSync(`${gate}.ready`), output);
  const source = join(f.runtime.staging, 'source'), store = dirname(f.runtime.directory);
  writeFileSync(join(source, 'cli/templates/project/prompt.md'), 'Bundle B implementation prompt');
  const b = prepareRuntimeBundle({ sourceRoot: source, runtimeStore: store, install: installPackages });
  const paths = { data: dirname(store), runtimes: store, runtimeDescriptor: join(dirname(store), 'runtime.json') } as any;
  withRuntimeLock(paths, () => { recordRuntimeOwnership(paths, b.id); writeRuntimeDescriptor(paths, b.id); });
  writeFileSync(`${gate}.release`, '');
  const [code] = await finished; assert.equal(code, 0, output);
  const launched = join(f.fake, 'launch-context'), limit = Date.now() + 3000;
  while (!existsSync(launched) && Date.now() < limit) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(JSON.parse(f.bytes(launched)), { project: f.root, runtime: f.runtime.directory, id: f.runtime.id });
  assert.match(f.bytes(join(f.fake, 'launches')), new RegExp(`${f.runtime.id}/main\\.mts`));
  assert.equal(existsSync(join(f.root, '.factory/logs/run-7.log')), true);
  assert.equal(existsSync(join(f.runtime.directory, 'logs')), false);
  assert.equal(JSON.parse(readFileSync(paths.runtimeDescriptor, 'utf8')).id, b.id);
});

for (const olderManual of [false, true]) {
  test(`out-of-order ${olderManual ? "manual then scheduled" : "scheduled then manual"} refresh keeps newer facts and analysis`, async (t) => {
    const f = fixture(t), record = f.record(7, "stopped"), gate = join(f.fake, "gate");
    f.save();
    // Only the older process has the gate variable. The newer analyst runs to completion before we release it.
    writeFileSync(join(f.home, "bin/pi"), `#!/bin/sh
if [ -n "$REFRESH_TEST_GATE" ]; then
  touch "$REFRESH_TEST_GATE.ready"
  while [ ! -f "$REFRESH_TEST_GATE.release" ]; do sleep 0.02; done
fi
exec "${f.node}" "${join(FIXTURES, "refresh-analysis.mjs")}" "$@"
`, { mode: 0o755 });
    const older = spawn(f.node, [join(f.runtime.directory, 'dispatch.mts'), "--base", "main", ...(olderManual ? ["--refresh-only", "--ticket", "7"] : [])], {
      cwd: f.root, detached: true, env: { ...f.env, REFRESH_TEST_GATE: gate }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    older.stdout.on("data", (s) => { output += s; }); older.stderr.on("data", (s) => { output += s; });
    const closed = once(older, "close");
    t.after(() => { try { process.kill(-older.pid!, "SIGKILL"); } catch { /* group already gone */ } });
    const deadline = Date.now() + 10_000;
    while (!existsSync(`${gate}.ready`) && older.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(existsSync(`${gate}.ready`), `older analysis paused: ${output}`);
    assert.equal(f.assessment().analysisState, "pending");
    assert.equal(f.assessment().facts?.title, "Ticket 7");
    f.data.tickets[0].title = "Edited NEW ticket";
    f.data.tickets[0].description = "Edited DEP:21";
    requestRefresh(f.dir, f.key(7), "7", "owner/repo");
    f.pass(olderManual ? [] : ["--refresh-only", "--ticket", "7"]);
    const authoritative = f.assessment();
    assert.equal(authoritative.facts?.title, "Edited NEW ticket");
    assert.equal(authoritative.analysisState, "current");
    assert.equal(authoritative.pending, false);
    assert.deepEqual(authoritative.dependencies?.map((b) => b.iid), [21]);
    writeFileSync(`${gate}.release`, "");
    const [code] = await closed;
    assert.equal(code, 0, output);
    assert.deepEqual(f.assessment(), authoritative, "older completion cannot overwrite or erase the newer result");
    assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
    assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
    assert.equal(existsSync(join(f.fake, "launches")), false);
  });
}

test("an older catalogue failure cannot overwrite a newer process's successful assessment", async (t) => {
  const f = fixture(t), record = f.record(7, "stopped"), gate = join(f.fake, "catalogue-gate");
  f.save();
  writeFileSync(join(f.home, "bin/gh"), `#!/bin/sh
if [ -n "$REFRESH_TEST_GATE" ] && [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  touch "$REFRESH_TEST_GATE.ready"
  while [ ! -f "$REFRESH_TEST_GATE.release" ]; do sleep 0.02; done
  echo 'old catalogue failure' >&2
  exit 2
fi
exec "${f.node}" "${join(FIXTURES, "refresh-tracker.mjs")}" "$@"
`, { mode: 0o755 });
  const older = spawn(f.node, [join(f.runtime.directory, 'dispatch.mts'), "--refresh-only", "--ticket", "7", "--base", "main"], {
    cwd: f.root, detached: true, env: { ...f.env, REFRESH_TEST_GATE: gate }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  older.stdout.on("data", (s) => { output += s; }); older.stderr.on("data", (s) => { output += s; });
  const closed = once(older, "close");
  t.after(() => { try { process.kill(-older.pid!, "SIGKILL"); } catch { /* group already gone */ } });
  const deadline = Date.now() + 10_000;
  while (!existsSync(`${gate}.ready`) && older.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.ok(existsSync(`${gate}.ready`), `older catalogue paused: ${output}`);
  f.data.tickets[0].title = "Newer facts before catalogue error";
  requestRefresh(f.dir, f.key(7), "7", "owner/repo");
  f.pass(["--refresh-only", "--ticket", "7"]);
  const authoritative = f.assessment();
  assert.equal(authoritative.analysisState, "current");
  assert.equal(authoritative.pending, false);
  writeFileSync(`${gate}.release`, "");
  const [code] = await closed;
  assert.equal(code, 0, output);
  assert.match(output, /old catalogue failure/);
  assert.deepEqual(f.assessment(), authoritative);
  assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
  assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
});

test("a superseded manual worker timeout cannot overwrite a newer scheduled result", async (t) => {
  const f = fixture(t), record = f.record(7, "stopped"), gate = join(f.fake, "worker-gate");
  f.save();
  writeFileSync(join(f.home, "bin/pi"), `#!/bin/sh
if [ -n "$REFRESH_TEST_GATE" ]; then
  touch "$REFRESH_TEST_GATE.ready"
  while [ ! -f "$REFRESH_TEST_GATE.release" ]; do sleep 0.02; done
fi
exec "${f.node}" "${join(FIXTURES, "refresh-analysis.mjs")}" "$@"
`, { mode: 0o755 });
  const env = { ...process.env };
  Object.assign(process.env, f.env, { REFRESH_TEST_GATE: gate });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
  requestRefresh(f.dir, f.key(7), "7", "owner/repo");
  const { writeAssessment } = await import("../board/assessment.mts");
  writeAssessment(f.dir, f.key(7), { iid: "7", project: "owner/repo", projectRoot: f.root });
  const { executeRefresh } = await import("../board/refresh-worker.mts");
  const job = executeRefresh(f.key(7), 3000);
  try {
    const deadline = Date.now() + 2500;
    while (!existsSync(`${gate}.ready`) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(existsSync(`${gate}.ready`), "manual child reached its pending analysis using the worker's token");
    assert.equal(f.assessment().analysisState, "pending");
    f.data.tickets[0].title = "Newer scheduled title";
    f.data.tickets[0].description = "new DEP:21";
    f.pass();
    const authoritative = f.assessment();
    assert.equal(authoritative.facts?.title, "Newer scheduled title");
    assert.equal(authoritative.analysisState, "current");
    assert.equal(authoritative.pending, false);
    await job;
    assert.deepEqual(f.assessment(), authoritative, "the worker's timeout error is fenced too");
    assert.equal(f.bytes(join(f.dir, `${f.key(7)}.json`)), record);
    assert.equal(existsSync(join(f.dir, "admission/state.json")), false);
  } finally { await job; }
});

test("analysis is bounded by GRAPH.maxAnalysesPerPass across execution and assessment", (t) => {
  const f = fixture(t);
  f.data.tickets = [...Array(7)].map((_, i) => ticket(i + 1)); f.data.ready = [];
  for (let i = 1; i <= 7; i++) f.record(i, "stopped");
  f.pass();
  assert.equal(f.bytes(join(f.fake, "analysis.jsonl")).trim().split("\n").length, 5);
  assert.equal([...Array(7)].filter((_, i) => f.assessment(i + 1).analysisState === "pending").length, 2);
});

test("assessment read, write/rename and request-removal failures preserve eligible launches and admission", (t) => {
  const results: any[] = [];
  for (const failure of ["healthy", "read", "write", "rename", "remove"]) {
    const f = fixture(t); f.record(8, "stopped"); f.data.tickets.push(ticket(8)); f.manifest(7);
    // Ensure no analysis is necessary to make the same #7 launch decision in every scenario.
    const dir = join(f.dir, "assessment"), refresh = join(f.dir, "refresh");
    if (failure === "read") writeFileSync(dir, "not a directory");
    if (failure === "write") symlinkSync(join(f.home, "missing-parent", "assessment"), dir);
    if (failure === "rename") mkdirSync(join(dir, `${f.key(8)}.json`), { recursive: true });
    if (failure === "remove") {
      mkdirSync(refresh); mkdirSync(join(refresh, `${f.key(8)}.json`));
    }
    const pass = f.pass();
    assert.match(pass.stdout, /#7 Ticket 7: launching/);
    if (failure !== "healthy") assert.match(pass.stdout + pass.stderr, /assessment store/);
    const admission = JSON.parse(f.bytes(join(f.dir, "admission/state.json")));
    results.push({ generations: admission.generations, keys: Object.keys(admission.claims), launch: /#7 Ticket 7: launching/.test(pass.stdout) });
  }
  for (const r of results) assert.deepEqual(r, results[0]);
});

test('project hold precedes tracker reads, analysis, queue and admission for manual and scheduled passes; fresh success resumes without retrying stopped work', t => {
  const f = fixture(t);
  f.data.tickets.push(ticket(8, { description: 'No dependencies' })); f.data.ready.push(8);
  f.record(8, 'stopped'); const stopped = f.bytes(join(f.dir, f.key(8) + '.json'));
  const logs = join(f.root, '.factory/logs');
  symlinkSync(f.fake, logs);
  f.save();
  for (const scheduled of [false, true]) {
    const r = spawnSync(f.node, [join(f.runtime.directory, 'dispatch.mts'), '--base', 'main'], { cwd: f.root, encoding: 'utf8', env: { ...f.env, ...(scheduled ? { FACTORY_SCHEDULED: '1' } : {}) } });
    assert.equal(r.status, 1); assert.match(r.stdout + r.stderr, /project held/);
    assert.equal(existsSync(join(f.fake, 'tracker.jsonl')), false);
    assert.equal(existsSync(join(f.fake, 'analysis.jsonl')), false);
    assert.equal(existsSync(join(f.fake, 'launches')), false);
    assert.equal(existsSync(join(f.dir, f.key(7) + '.json')), false);
    assert.equal(existsSync(join(f.dir, 'admission/state.json')), false);
    assert.equal(f.bytes(join(f.dir, f.key(8) + '.json')), stopped);
  }
  rmSync(logs); f.manifest(7); f.pass(['--dry-run']);
  assert.equal(f.bytes(join(f.dir, f.key(8) + '.json')), stopped);
  assert.equal(existsSync(join(f.fake, 'tracker.jsonl')), true);
});

test('a branch created during the final fresh context read is held before admission without deletion, then a fresh pass can succeed', t => {
  const f = fixture(t); f.data.tickets[0].description = 'No dependencies'; f.manifest(7); f.data.workspaceRace = true;
  const raced = f.pass(); assert.match(raced.stdout, /#7 held before admission: Branch already exists/);
  assert.equal(existsSync(join(f.dir, f.key(7) + '.json')), false);
  assert.equal(existsSync(join(f.dir, 'admission/state.json')), false);
  assert.equal(git(f.root, 'branch', '--list', '7-ticket-7'), '7-ticket-7');
  // Stand in for an operator resolving this synthetic conflict, not an automatic Factory repair.
  git(f.root, 'branch', '-D', '7-ticket-7'); f.data.workspaceRace = false;
  assert.match(f.pass().stdout, /#7 Ticket 7: launching/);
});

for (const conflict of ['input', 'workspace']) test(`one ${conflict} hold preserves the ticket and admits an unrelated ticket`, t => {
  const f = fixture(t);
  f.data.tickets[0].description = 'No dependencies';
  f.data.tickets.push(ticket(8, { description: 'No dependencies' })); f.data.ready.push(8);
  f.manifest(7); f.manifest(8);
  if (conflict === 'input') f.data.contextErrors = [7];
  else git(f.root, 'branch', '7-ticket-7');
  const result = f.pass();
  assert.match(result.stdout, /#7 held:/); assert.match(result.stdout, /#8 Ticket 8: launching/);
  assert.equal(existsSync(join(f.dir, f.key(7) + '.json')), false);
  const admission = JSON.parse(f.bytes(join(f.dir, 'admission/state.json')));
  assert.equal(Object.keys(admission.claims).length, 1); assert.ok(admission.claims[f.key(8)]);
});
