// Cheap identity units and one disposable admission/filesystem boundary with an IPC-coordinated real process race.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admissionConflict, admissionFile, claimManagedEntry, emptyAdmission, migrateAdmission, ownerOf, readAdmission, releaseManagedEntry, withAdmission } from '../../board/admission.mts';
import { adoptClaim, claimDelivery, claimRun, holdClaim, setProject } from '../../board/board.mts';
import { readAdmission as oldRead } from './admission-v1.fixture.mts';
import { canonicalAdmissionProject, checkSupervisorHold, claimSupervisorHold, releaseSupervisorHold } from '../src/supervisor-admission.mts';
import { prepareRuntimeBundle } from '../src/runtime-bundle.mts';
import { installPackages as install } from './runtime-fixture.mts';

const project = (root: string, name = 'owner/repo') => ({ root, tracker: { kind: 'github' as const, host: 'github.com', project: name } });
test('schema migration refuses optional-exclusion bypass, missing v2 collections and unknown versions', () => {
  const v1 = { version: 1, claims: {}, generations: { saved: 12 }, recovery: { saved: { admitted: 3, pending: [], candidates: { ['b'.repeat(64)]: 'saved-attempt' } } } };
  const migrated = migrateAdmission(v1);
  assert.deepEqual(migrated.generations, v1.generations); assert.deepEqual(migrated.recovery, v1.recovery);
  for (const invalid of [{ ...v1, supervisorHolds: {} }, { ...v1, entries: {} }, { ...v1, version: 2 }, { ...emptyAdmission(), version: 3 }, { ...emptyAdmission(), supervisorHolds: null }])
    assert.throws(() => migrateAdmission(invalid), /Unsupported admission/);
});

test('canonical root and tracker namespace collisions do not depend on display names or tracker host', () => {
  assert(admissionConflict(project('/a'), project('/b')));
  assert(admissionConflict(project('/a'), project('/a', 'different/repo')));
  assert(admissionConflict(project('/a', 'owner/repo'), { ...project('/b', 'owner_repo'), tracker: { kind: 'gitlab', host: 'elsewhere.test', project: 'owner_repo' } }));
  assert(!admissionConflict(project('/a'), project('/b', 'other/repo')));
});

test('durable schema, v1 compatibility, full mediation, exact fences and one real interprocess claim race', async t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-admission-v2-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'state'), checkout = join(root, 'checkout'); mkdirSync(join(dir, 'admission'), { recursive: true }); mkdirSync(checkout);
  const alias = join(root, 'alias'); symlinkSync(checkout, alias);
  assert.deepEqual(canonicalAdmissionProject(project(alias)), project(checkout));
  const file = admissionFile(dir);
  const legacy: any = { version: 1, claims: { 'owner_repo--7': { token: 'claim', project: 'owner/repo', iid: '7', kind: 'recovery', owner: ownerOf(process.pid), at: 'saved', attempt: 'attempt' } },
    generations: { 'owner/repo': 19 }, recovery: { 'owner/repo': { admitted: 4, pending: [{ id: 'attempt', iid: '7', root: checkout, at: 'saved', branch: 'saved-branch', log: 'log', container: 'container', record: 'record' }], candidates: { ['a'.repeat(64)]: 'attempt' } } } };
  const bytes = JSON.stringify(legacy); writeFileSync(file, bytes);
  const migrated = readAdmission(dir); assert.equal(migrated.version, 2); assert.equal(readFileSync(file, 'utf8'), bytes);
  for (const key of ['claims','generations','recovery']) assert.deepEqual(migrated[key], legacy[key]);
  withAdmission(dir, tx => tx.commit());
  assert.throws(() => oldRead(dir), /Unsupported admission/);
  for (const corrupt of ['{broken', JSON.stringify({ ...emptyAdmission(), supervisorHolds: undefined }), JSON.stringify({ ...legacy, supervisorHolds: {} }), JSON.stringify({ ...emptyAdmission(), entries: { orphan: {} } })]) {
    writeFileSync(file, corrupt); assert.throws(() => withAdmission(dir, tx => tx.commit()));
    assert.throws(() => claimManagedEntry(dir, project(checkout))); assert.equal(readFileSync(file, 'utf8'), corrupt);
  }
  writeFileSync(file, JSON.stringify(emptyAdmission()));
  const runtime = prepareRuntimeBundle({ sourceRoot: new URL('../../', import.meta.url).pathname, runtimeStore: join(root, 'runtimes'), install });
  const options = { project: project(alias), invocationId: 'invocation', runtimeRoot: runtime.directory,
    rollout: { olderRuntimesQuiesced: true as const, unmanagedWorkQuiesced: true as const } };
  assert.throws(() => claimSupervisorHold(dir, { ...options, rollout: undefined as any }), /quiescence/);
  const entry = claimManagedEntry(dir, project(checkout));
  assert.throws(() => claimSupervisorHold(dir, options), /not quiescent/);
  assert(releaseManagedEntry(dir, entry));
  writeFileSync(join(dir, 'unknown.json'), '{broken');
  assert.throws(() => claimSupervisorHold(dir, options), /unreadable run ownership/); rmSync(join(dir, 'unknown.json'));
  writeFileSync(join(dir, 'untracked.json'), JSON.stringify({ stage: 'implementing', pid: 99999999 }));
  assert.throws(() => claimSupervisorHold(dir, options), /unknown run ownership/); rmSync(join(dir, 'untracked.json'));

  // Stage is not ownership/cleanup proof. Rollout booleans never override contradictory raw records.
  for (const stage of ['queued','waiting','done','stopped']) {
    for (const payload of [
      {pid:process.pid,starting:true,claim:'untracked'},
      {pid:process.pid},
      {pid:99999999,claim:'dangling'},
      {pid:99999999,starting:true},
      {pid:99999999,recovery:{container:'unresolved',cleanup:'pending'}},
      {pid:99999999}, // Dead controller with no definitive payload cleanup is still unknown.
    ]) {
      const bytes=JSON.stringify({iid:'7',project:'owner/repo',stage,...payload});
      const raw=join(dir,'untracked.json'); writeFileSync(raw,bytes);
      assert.throws(()=>claimSupervisorHold(dir,options),/unknown run ownership/);
      assert.equal(readFileSync(raw,'utf8'),bytes); assert.deepEqual(readAdmission(dir).supervisorHolds,{});
      rmSync(raw);
    }
  }

  // Both real children are ready before either receives go. Admission's actual interprocess lock picks one winner.
  const children = [0, 1].map(() => fork(new URL('./supervisor-admission-race.fixture.mts', import.meta.url), [], { stdio: ['ignore','pipe','pipe','ipc'] }));
  t.after(() => children.forEach(child => { if (child.connected) child.send({ exit: true }); }));
  const exits = children.map(child => once(child, 'exit'));
  await Promise.all(children.map(child => once(child, 'message')));
  const outcomes = children.map(child => once(child, 'message'));
  children.forEach((child, i) => child.send({ dir, options: { ...options, invocationId: `race-${i}` } }));
  const results = (await Promise.all(outcomes)).map(([value]) => value as any);
  assert.equal(results.filter(r => r.hold).length, 1); assert.equal(results.filter(r => r.error).length, 1);
  const hold = results.find(r => r.hold).hold;
  assert(checkSupervisorHold(dir, hold));
  assert.equal(releaseSupervisorHold(dir, hold).released, false, 'live owner with absent authorization is not release evidence');
  const before = readAdmission(dir); assert.deepEqual(before.generations, {}); assert.deepEqual(before.recovery, {}); assert.deepEqual(before.claims, {});
  children.forEach(child => child.send({ exit: true })); await Promise.all(exits);
  // Real owner death does not prune the hold, even on an unrelated committed normal-store transaction.
  withAdmission(dir, tx => {
    for (const kind of ['normal', 'delivery'] as const) tx.state.claims[`other--${kind}`] = { token: kind, project: 'other', iid: kind, kind, owner: hold.owner, at: 'saved' };
    tx.commit();
  });
  assert.deepEqual(readAdmission(dir).claims, {}, 'existing normal/delivery dead-owner pruning remains unchanged');
  assert(checkSupervisorHold(dir, hold));
  const heldBytes = readFileSync(file, 'utf8');
  assert.throws(() => withAdmission(dir, tx => { (tx.state as any).version = 1; tx.commit(); }), /downgrade/);
  assert.equal(readFileSync(file, 'utf8'), heldBytes);
  assert.equal(checkSupervisorHold(dir, { ...hold, fence: 'foreign' }), false);
  assert.equal(checkSupervisorHold(dir, { ...hold, project: project(checkout, 'foreign/repo') }), false);
  assert.match(releaseSupervisorHold(dir, { ...hold, fence: 'foreign' }).reason, /does not match/);
  assert.match(releaseSupervisorHold(dir, hold).reason, /settlement authority/);
  assert(checkSupervisorHold(dir, hold), 'no-send absence and dead owner do not establish release authority');
  const successor = { ...hold, fence: 'successor', invocationId: 'successor', owner: ownerOf(process.pid), pending: ['journal-reservation-ref'] };
  withAdmission(dir, tx => { tx.state.supervisorHolds[hold.id] = successor; tx.commit(); });
  assert.equal(releaseSupervisorHold(dir, hold).released, false); assert(checkSupervisorHold(dir, successor));
  assert.equal(releaseSupervisorHold(dir, successor).released, false, 'a pending reference is not final settlement');
  for (const kind of ['normal','recovery','delivery'] as const) {
    assert.equal(claimRun({ dir, iid: '8', project: 'owner/repo', pid: process.pid, cap: 4, kind, attempt: 'repair' }).ok, false);
  }
  assert.equal(claimDelivery({ dir, iid: '8', project: 'owner_repo', pid: process.pid, cap: 4 }).ok, false);
  assert.throws(() => claimManagedEntry(dir, project(checkout, 'renamed/repo')), /held by supervisor/);
  setProject('owner/repo'); t.after(() => { setProject(''); holdClaim(undefined); });
  assert.throws(() => adoptClaim('8', dir), /held by supervisor/);
  assert(checkSupervisorHold(dir, successor));
  const manualDir = join(root, 'manual');
  const manualToken = adoptClaim('9', manualDir, 1); assert.ok(manualToken);
  assert.equal(readAdmission(manualDir).claims['owner_repo--9'].token, manualToken);
  assert.equal(readAdmission(manualDir).generations['owner/repo'], 1, 'manual implementation admission has exactly one normal generation');
  assert.throws(() => adoptClaim('10', manualDir, 1), /no capacity/);
  const manualBytes = readFileSync(admissionFile(manualDir), 'utf8');
  writeFileSync(join(manualDir, 'owner_repo--10.json'), 'null');
  assert.throws(() => adoptClaim('10', manualDir, 1), /ownership is unknown/);
  assert.equal(readFileSync(admissionFile(manualDir), 'utf8'), manualBytes);
});
