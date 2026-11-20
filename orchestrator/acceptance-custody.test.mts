// Pure preparation/binding fixtures plus one disposable filesystem custody boundary.
// Faults and two native publishers use local Node only, never trackers, containers or agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceHash, acceptanceIdentity, type AcceptanceContract, type ApprovalRecord } from './acceptance-contract.mts';
import { freezeTicketInput, frozenTicketIdentity } from './ticket-input.mts';
import { ACCEPTANCE_CUSTODY_LIMITS, AcceptanceCustodyHold, copyAcceptanceForRunner, freezeAcceptanceBundle, prepareAcceptanceBundle, readAcceptanceBundle, resolveAcceptanceArtifacts, type AcceptancePreparation } from './acceptance-custody.mts';

const example = JSON.parse(readFileSync(new URL('../docs/acceptance-contract.md', import.meta.url), 'utf8').match(/```json\n([\s\S]*?)\n```/)![1]) as AcceptanceContract;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fixture(): AcceptancePreparation {
  const contract = structuredClone(example);
  const artifacts = [{ path: 'probes/export.mjs', bytes: Buffer.from('/* independent reviewed probe */') }, { path: 'fixtures/rows.json', bytes: Buffer.from('[1,2]') }];
  contract.probes[0].bundle[0].sha256 = sha(artifacts[0].bytes); contract.fixtures[0].sha256 = sha(artifacts[1].bytes);
  const ticket = freezeTicketInput({ identity: { kind: 'github', host: 'github.test', project: 'owner/repo' },
    ticket: iid => ({ bytes: 1, value: { iid, title: 'Frozen requirements', description: 'Export summary', url: 'https://github.test/owner/repo/issues/7' } }),
    parentOf: () => ({ bytes: 1, value: null }), notes: () => ({ bytes: 1, value: { notes: [], nextPage: null } }) }, 7);
  const identity = acceptanceIdentity(contract), ticketIdentity = frozenTicketIdentity(ticket);
  const approval: ApprovalRecord = { version: 1, id: 'review-17', identity, approvedRevision: contract.revision,
    reviewer: { kind: 'human', name: 'reviewer@example.invalid' }, decision: 'approve', semanticAdequacy: true,
    provenance: 'authenticated-host-review:17', reviewedAt: '2026-11-20T16:00:00.000Z' };
  // Synthetic authenticated store: records are scoped to both exact requirements and acceptance.
  return { contract, ticket, artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)), approvals: { lookup: binding => acceptanceHash(binding) === acceptanceHash({ ticket: ticketIdentity, acceptance: identity }) ? structuredClone(approval) : undefined } };
}
const held = (fn: () => unknown) => assert.throws(fn, AcceptanceCustodyHold);

test('pure preparation binds full requirements, criteria, probe, fixture and trusted approval identities', () => {
  const f = fixture(), prepared = prepareAcceptanceBundle(f);
  assert.equal(prepared.pointer.id, acceptanceHash(prepared.manifest));
  assert.deepEqual(prepared.manifest.ticket, frozenTicketIdentity(f.ticket));
  assert.equal(prepared.manifest.criteriaDigest, acceptanceHash((f.contract as AcceptanceContract).criteria));
  for (const mutate of [
    (x: AcceptancePreparation) => { (x.contract as AcceptanceContract).criteria[0].behavior += ' changed'; },
    (x: AcceptancePreparation) => { (x.contract as AcceptanceContract).probes[0].argv.push('candidate-expected-results'); },
    (x: AcceptancePreparation) => { (x.contract as AcceptanceContract).fixtures[0].sha256 = 'c'.repeat(64); },
    (x: AcceptancePreparation) => { x.artifacts[0].bytes[0] ^= 1; },
    (x: AcceptancePreparation) => { x.artifacts[1].bytes[0] ^= 1; },
    (x: AcceptancePreparation) => { x.ticket.text += 'changed'; },
    (x: AcceptancePreparation) => { x.approvals = { lookup: () => ({ identity: acceptanceIdentity(x.contract as AcceptanceContract), sha256: 'a'.repeat(64), decision: 'approve' }) }; },
    (x: AcceptancePreparation) => { x.approvals = { lookup: () => undefined }; },
  ]) { const changed = fixture(); mutate(changed); held(() => prepareAcceptanceBundle(changed)); }
  const renewed = fixture(), prior = renewed.approvals;
  renewed.approvals = { lookup: b => ({ ...(prior.lookup(b) as ApprovalRecord), id: 'review-18', provenance: 'authenticated-host-review:18' }) };
  assert.notEqual(prepareAcceptanceBundle(renewed).pointer.id, prepared.pointer.id, 'new approval is a new identity, not a historical rewrite');
  const bytes = prepared.files[0].bytes.toString(); f.ticket.text += 'later mutation';
  assert.equal(prepared.files[0].bytes.toString(), bytes, 'prepared originals do not alias input');
});

test('pure preparation rejects traversal, path collisions, missing/extra/oversized bytes and stale approvals', () => {
  for (const path of ['../escape', '/absolute', 'probes/../escape', 'probes//file', 'probes\\file', 'https://remote/probe', 'probes/./file']) {
    const f = fixture(); (f.contract as AcceptanceContract).probes[0].bundle[0].path = path; held(() => prepareAcceptanceBundle(f));
  }
  const f = fixture(); held(() => prepareAcceptanceBundle({ ...f, artifacts: [] }));
  held(() => prepareAcceptanceBundle({ ...f, artifacts: [...f.artifacts, f.artifacts[0]] }));
  held(() => prepareAcceptanceBundle({ ...f, artifacts: [{ ...f.artifacts[0], bytes: Buffer.alloc(ACCEPTANCE_CUSTODY_LIMITS.artifactBytes + 1) }, f.artifacts[1]] }));
  const newlyReviewed = (x: AcceptancePreparation) => {
    const old = x.approvals.lookup({ ticket: frozenTicketIdentity(f.ticket), acceptance: acceptanceIdentity(f.contract as AcceptanceContract) }) as ApprovalRecord;
    return { ...x, approvals: { lookup: () => ({ ...old, identity: acceptanceIdentity(x.contract as AcceptanceContract) }) } };
  };
  const collision = fixture(); (collision.contract as AcceptanceContract).fixtures[0].path = 'probes/export.mjs/rows.json';
  held(() => prepareAcceptanceBundle(newlyReviewed(collision)));
  const tooMany = fixture(), c = tooMany.contract as AcceptanceContract;
  c.probes[0].bundle = Array.from({ length: 256 }, (_, i) => ({ id: `B-${i}`, path: `probes/${i}.mjs`, sha256: c.probes[0].bundle[0].sha256 }));
  held(() => prepareAcceptanceBundle(newlyReviewed(tooMany)));
  const aggregate = fixture(), large = Buffer.alloc(ACCEPTANCE_CUSTODY_LIMITS.artifactBytes), largeDigest = sha(large);
  (aggregate.contract as AcceptanceContract).probes[0].bundle = Array.from({ length: 17 }, (_, i) => ({ id: `B-${i}`, path: `probes/${i}.mjs`, sha256: largeDigest }));
  aggregate.artifacts = [aggregate.artifacts[0], ...Array.from({ length: 17 }, (_, i) => ({ path: `probes/${i}.mjs`, bytes: large }))];
  held(() => prepareAcceptanceBundle(newlyReviewed(aggregate)));
});

test('filesystem boundary: exclusive freeze, exact resume, immutable private copies and retained tamper/partial state', { timeout: 15_000 }, async t => {
  const base = mkdtempSync(join(tmpdir(), 'acceptance-custody-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'originals'), project = join(base, 'project'), copies = join(base, 'runner-copies');
  for (const dir of [root, project, copies]) mkdirSync(dir, { mode: 0o700 });
  const f = fixture(), options = { ...f, root, agentMounts: [project] };
  const pointer = freezeAcceptanceBundle(options), originalDir = join(root, pointer.id);
  const snapshot = () => readdirSync(originalDir).sort().map(name => [name, readFileSync(join(originalDir, name)).toString('base64')]);
  const before = snapshot();
  assert.deepEqual(freezeAcceptanceBundle(options), pointer);
  assert.equal(statSync(join(originalDir, 'contract.json')).mode & 0o777, 0o400);
  for (const phase of ['resume', 'repair']) {
    const loaded = readAcceptanceBundle(root, [project], pointer);
    assert.equal(loaded.ticket.hash, f.ticket.hash, phase);
    assert.deepEqual(loaded.artifacts.map(a => Buffer.from(a.bytes)), f.artifacts.map(a => Buffer.from(a.bytes)));
    loaded.artifacts[0].bytes[0] ^= 1;
    assert.deepEqual(snapshot(), before, 'caller mutation never alters originals');
  }
  const copy = copyAcceptanceForRunner(root, [project], pointer, join(copies, 'attempt-1'));
  assert.equal(statSync(join(copy, 'probes/export.mjs')).mode & 0o777, 0o400);
  chmodSync(join(copy, 'probes/export.mjs'), 0o600); writeFileSync(join(copy, 'probes/export.mjs'), 'runner private mutation');
  assert.deepEqual(snapshot(), before);
  held(() => copyAcceptanceForRunner(root, [project], pointer, join(project, 'candidate-copy')));
  held(() => copyAcceptanceForRunner(root, [project], pointer, join(root, 'copy')));
  for (const mounts of [[root], [base], ['/'], [originalDir]]) held(() => readAcceptanceBundle(root, mounts, pointer));
  const alias = join(base, 'alias'); symlinkSync(root, alias); held(() => readAcceptanceBundle(alias, [project], pointer));
  const fileMount = join(project, 'config'); writeFileSync(fileMount, 'data');
  assert.deepEqual(readAcceptanceBundle(root, [fileMount], pointer).pointer, pointer);

  // Every authoritative component is rehashed; originals survive refusal without replacement.
  for (const name of ['ticket.json', 'contract.json', 'approval.json', 'artifact-000', 'artifact-001', 'manifest.json', 'sealed.json']) {
    const file = join(originalDir, name), bytes = readFileSync(file);
    chmodSync(file, 0o600); writeFileSync(file, Buffer.concat([bytes, Buffer.from(' ')]));
    held(() => readAcceptanceBundle(root, [project], pointer));
    held(() => freezeAcceptanceBundle(options));
    assert.deepEqual(readFileSync(file), Buffer.concat([bytes, Buffer.from(' ')]));
    // Fixture-only restore is deliberately NOT a production custody API.
    writeFileSync(file, bytes); chmodSync(file, 0o400);
  }
  const artifact = join(originalDir, 'artifact-000'), bytes = readFileSync(artifact);
  rmSync(artifact); held(() => readAcceptanceBundle(root, [project], pointer)); held(() => freezeAcceptanceBundle(options));
  assert.equal(existsSync(artifact), false, 'missing original not refetched or replaced');
  symlinkSync(join(copy, 'probes/export.mjs'), artifact); held(() => readAcceptanceBundle(root, [project], pointer)); rmSync(artifact);
  writeFileSync(artifact, bytes, { mode: 0o400 });
  linkSync(artifact, join(base, 'hardlink')); held(() => readAcceptanceBundle(root, [project], pointer)); rmSync(join(base, 'hardlink'));
  writeFileSync(join(originalDir, 'unknown.partial'), 'retained'); held(() => readAcceptanceBundle(root, [project], pointer));
  assert.equal(readFileSync(join(originalDir, 'unknown.partial'), 'utf8'), 'retained'); rmSync(join(originalDir, 'unknown.partial'));

  // Digest-only local resolution refuses aliases, traversal and oversize before execution.
  const source = join(base, 'source'); mkdirSync(source, { mode: 0o700 });
  for (const a of f.artifacts) { mkdirSync(join(source, a.path.split('/')[0]), { recursive: true }); writeFileSync(join(source, a.path), a.bytes); }
  assert.deepEqual(resolveAcceptanceArtifacts(source, f.contract), f.artifacts);
  const sourceProbe = join(source, f.artifacts[0].path); rmSync(sourceProbe); symlinkSync(artifact, sourceProbe);
  held(() => resolveAcceptanceArtifacts(source, f.contract)); rmSync(sourceProbe);
  writeFileSync(sourceProbe, Buffer.alloc(ACCEPTANCE_CUSTODY_LIMITS.artifactBytes + 1)); held(() => resolveAcceptanceArtifacts(source, f.contract));
  writeFileSync(sourceProbe, 'not the approved bytes'); held(() => resolveAcceptanceArtifacts(source, f.contract));

  // Inject failure during real publication, then prove a fresh read/freeze cannot repair it.
  const failedRoot = join(base, 'interrupted'); mkdirSync(failedRoot, { mode: 0o700 });
  const child = join(base, 'interrupt.mjs');
  writeFileSync(child, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const original = fs.fsyncSync; let count = 0;
fs.fsyncSync = fd => { if (++count === 2) throw Error('injected partial publication'); return original(fd); }; syncBuiltinESMExports();
const {freezeAcceptanceBundle} = await import(${JSON.stringify(new URL('./acceptance-custody.mts', import.meta.url).href)});
const f = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); f.artifacts.forEach(a => a.bytes = Buffer.from(a.bytes));
try {freezeAcceptanceBundle({...f,root:process.argv[3],agentMounts:[],approvals:{lookup:()=>f.approval}}); process.exitCode=9;} catch {process.exitCode=0;}`);
  const data = join(base, 'preparation.json'), prepared = prepareAcceptanceBundle(f);
  const approval = JSON.parse(prepared.files.find(x => x.name === 'approval.json')!.bytes.toString());
  writeFileSync(data, JSON.stringify({ ticket: f.ticket, contract: f.contract, artifacts: f.artifacts.map(a => ({ path: a.path, bytes: [...a.bytes] })), approval }));
  const crashed = spawnSync(process.execPath, [child, data, failedRoot], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  assert.equal(crashed.status, 0, crashed.stderr.toString());
  const partialDir = join(failedRoot, pointer.id), partialNames = readdirSync(partialDir);
  assert.ok(partialNames.length > 0); assert.equal(existsSync(join(partialDir, 'sealed.json')), false);
  held(() => readAcceptanceBundle(failedRoot, [], pointer)); held(() => freezeAcceptanceBundle({ ...options, root: failedRoot }));
  assert.deepEqual(readdirSync(partialDir), partialNames, 'partial originals retained');

  // Two real concurrent publishers race the exclusive reservation through IPC, no sleeps/retries.
  const raceRoot = join(base, 'race'); mkdirSync(raceRoot, { mode: 0o700 });
  const publisher = join(base, 'publisher.mjs');
  writeFileSync(publisher, `import fs from 'node:fs'; import {freezeAcceptanceBundle} from ${JSON.stringify(new URL('./acceptance-custody.mts', import.meta.url).href)};
const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); f.artifacts.forEach(a=>a.bytes=Buffer.from(a.bytes));
process.send('ready'); process.once('message',()=>{try{const p=freezeAcceptanceBundle({...f,root:process.argv[3],agentMounts:[],approvals:{lookup:()=>f.approval}});process.send({status:'frozen',p});}catch{process.send({status:'hold'});}process.disconnect();});`);
  const children = [0, 1].map(() => fork(publisher, [data, raceRoot], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  t.after(() => children.forEach(c => { if (c.exitCode === null) c.kill(); }));
  await Promise.all(children.map(c => once(c, 'message')));
  const messages = children.map(c => once(c, 'message')), exits = children.map(c => once(c, 'exit'));
  children.forEach(c => c.send('publish'));
  const results = (await Promise.all(messages)).map(([r]) => r); await Promise.all(exits);
  assert.ok(results.some(r => r.status === 'frozen'));
  assert.ok(results.every(r => ['frozen', 'hold'].includes(r.status)));
  assert.deepEqual(readAcceptanceBundle(raceRoot, [], pointer).pointer, pointer);
  assert.deepEqual(readdirSync(raceRoot), [pointer.id]);
});
