// Pure contract/transition policy fixtures reuse the portable documentation example.
// The one process boundary is a permission-denied import smoke check, not execution of probes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ACCEPTANCE_LIMITS, acceptanceHash, acceptanceIdentity, canonicalAcceptanceJSON, validateAcceptanceContract, checkAcceptanceApproval, checkAcceptanceResults, type AcceptanceContract, type ApprovalRecord, type AssertionStatus, type ResultEnvelope, type Check, type HoldCode } from './acceptance-contract.mts';

const markdown = readFileSync(new URL('../docs/acceptance-contract.md', import.meta.url), 'utf8');
const example = JSON.parse(markdown.match(/```json\n([\s\S]*?)\n```/)![1]) as AcceptanceContract;
const fixture = () => structuredClone(example);
const reviewer = 'reviewer@example.invalid';
const approval = (c: AcceptanceContract): ApprovalRecord => ({ version: 1, id: 'review-17', identity: acceptanceIdentity(c), approvedRevision: c.revision, reviewer: { kind: 'human', name: reviewer }, decision: 'approve', semanticAdequacy: true, provenance: 'host-review-store:review-17', reviewedAt: '2026-11-20T16:00:00.000Z' });
const ingress = (c: AcceptanceContract) => { const a = approval(c); return { lookup: () => structuredClone(a) }; };
function observed(c: AcceptanceContract, phase: 'baseline' | 'candidate'): ResultEnvelope {
  return { version: 1, phase, identity: acceptanceIdentity(c), assertions: c.assertions.map(a => ({ assertionId: a.id, status: phase === 'baseline' ? a.baseline : a.candidate, failureId: phase === 'baseline' ? a.failureId : null, evidence: [`receipt:${phase}:${a.id}`] })), evidence: c.criteria.flatMap(c => c.evidenceRequirements.map(requirement => ({ criterionId: c.id, requirement, reference: `review:${phase}:${c.id}` }))) };
}
const held = (r: Check<unknown>, code: HoldCode) => { assert.equal(r.status, 'hold'); if (r.status === 'hold') { assert.equal(r.code, code); assert.equal(r.nextActor, 'preparer-or-reviewer'); assert.ok(r.path); } };

test('documented mixed contract and evidence-only variants have explicit valid transitions', () => {
  const c = fixture();
  assert.equal(validateAcceptanceContract(c).status, 'valid');
  assert.equal(checkAcceptanceApproval(c, ingress(c)).status, 'valid');
  for (const phase of ['baseline', 'candidate'] as const) assert.equal(checkAcceptanceResults(c, ingress(c), observed(c, phase), phase).status, 'valid');
  for (const kind of ['documentation-only', 'refactor', 'investigation', 'manual'] as const) {
    const c = fixture(); c.criteria = [c.criteria[2]]; c.criteria[0].exception!.kind = kind; c.assertions = []; c.probes = []; c.fixtures = [];
    for (const phase of ['baseline', 'candidate'] as const) {
      assert.equal(checkAcceptanceResults(c, ingress(c), observed(c, phase), phase).status, 'valid');
      const r = observed(c, phase); r.evidence = []; held(checkAcceptanceResults(c, ingress(c), r, phase), 'missing-evidence');
    }
  }
});

test('aggregate criterion evidence fits the 256-record result envelope or fails before approval', () => {
  const c = fixture();
  const manual = c.criteria[2];
  c.criteria = [
    { ...structuredClone(manual), id: 'C-first', evidenceRequirements: Array.from({ length: 255 }, (_, i) => `review-${i}`) },
    { ...structuredClone(manual), id: 'C-second', evidenceRequirements: ['review-0'] },
  ];
  c.assertions = []; c.probes = []; c.fixtures = [];
  assert.equal(validateAcceptanceContract(c).status, 'valid');
  const trusted = ingress(c);
  assert.equal(checkAcceptanceApproval(c, trusted).status, 'valid');
  for (const phase of ['baseline', 'candidate'] as const) {
    const r = observed(c, phase);
    assert.equal(r.evidence.length, 256);
    assert.equal(checkAcceptanceResults(c, trusted, r, phase).status, 'valid');
    r.evidence.pop();
    held(checkAcceptanceResults(c, trusted, r, phase), 'missing-evidence');
  }
  // Both individual lists remain valid (256 + 1); obligations are criterion/requirement pairs.
  c.criteria[0].evidenceRequirements.push('review-255');
  const invalid = validateAcceptanceContract(c);
  held(invalid, 'invalid-contract');
  if (invalid.status === 'hold') {
    assert.equal(invalid.path, '$.criteria.evidenceRequirements');
    assert.match(invalid.reason, /aggregate evidence obligation limit/);
  }
  held(checkAcceptanceApproval(c, { lookup: () => assert.fail('oversized contract must not consult authority') }), 'invalid-contract');
});

test('maximum-length requirements and criterion ID fit both result phases beyond the contract byte ceiling', () => {
  const c = fixture();
  c.criteria = [c.criteria[2]]; c.assertions = []; c.probes = []; c.fixtures = [];
  c.criteria[0].id = 'C' + 'x'.repeat(79);
  c.criteria[0].evidenceRequirements = Array.from({ length: 256 }, (_, i) => String(i).padStart(3, '0') + 'x'.repeat(3997));
  assert.equal(validateAcceptanceContract(c).status, 'valid');
  const trusted = ingress(c);
  assert.equal(checkAcceptanceApproval(c, trusted).status, 'valid');
  for (const phase of ['baseline', 'candidate'] as const) {
    const r = observed(c, phase); r.evidence.forEach(e => { e.reference = 'x'; });
    const bytes = Buffer.byteLength(JSON.stringify(r));
    assert.ok(bytes > ACCEPTANCE_LIMITS.bytes && bytes < ACCEPTANCE_LIMITS.resultBytes);
    assert.equal(checkAcceptanceResults(c, trusted, r, phase).status, 'valid');
    // Schema-bounded references can still exceed the separate fixed result ceiling.
    r.evidence.forEach(e => { e.reference = '\u0001'.repeat(4000); });
    const oversized = checkAcceptanceResults(c, trusted, r, phase);
    held(oversized, 'invalid-results');
    if (oversized.status === 'hold') assert.equal(oversized.reason, 'content byte limit');
  }
  assert.throws(() => canonicalAcceptanceJSON('x'.repeat(ACCEPTANCE_LIMITS.bytes)), /content byte limit/);
});

for (const [name, character] of [['ASCII', 'x'], ['escaped quote', '"'], ['escaped control', '\u0001'], ['UTF-8', '界'], ['lone surrogate', '\ud800']] as const) {
  test(`maximum inventories and IDs with 4000-unit ${name} strings reconcile both phases`, () => {
    const c = fixture();
    const stableId = (prefix: string, i: number) => (prefix + String(i).padStart(3, '0')).padEnd(80, 'x');
    const changed = c.assertions[0], preserved = c.assertions[1], manual = c.criteria[2];
    c.assertions = Array.from({ length: 256 }, (_, i) => ({ ...structuredClone(i < 128 ? changed : preserved), id: stableId('A', i), failureId: i < 128 ? stableId('F', i) : null }));
    c.criteria = Array.from({ length: 256 }, (_, i) => ({
      ...structuredClone(i < 2 ? c.criteria[i] : manual), id: stableId('C', i),
      assertionIds: i < 2 ? c.assertions.slice(i * 128, (i + 1) * 128).map(a => a.id) : [],
      evidenceRequirements: [String(i).padStart(3, '0') + (i < 32 ? character.repeat(3997) : 'review')],
    }));
    c.criteria[0].behavior = character.repeat(4000);
    c.assertions[0].input = character.repeat(4000);
    assert.equal(validateAcceptanceContract(c).status, 'valid');
    const trusted = ingress(c);
    assert.equal(checkAcceptanceApproval(c, trusted).status, 'valid');
    for (const phase of ['baseline', 'candidate'] as const) {
      const r = observed(c, phase);
      r.assertions.forEach(a => { a.evidence = ['x']; }); r.evidence.forEach(e => { e.reference = 'x'; });
      assert.equal(r.assertions.length, 256); assert.equal(r.evidence.length, 256);
      assert.ok(Buffer.byteLength(JSON.stringify(r)) <= ACCEPTANCE_LIMITS.resultBytes);
      assert.equal(checkAcceptanceResults(c, trusted, r, phase).status, 'valid');
    }
  });
}

test('canonical identities are deterministic, key-order independent and exact-content bound', () => {
  assert.equal(acceptanceHash({ b: 2, a: [true, null, 'x'] }), 'ab9b02db7ec2d94733f11a399281a3d28694f36b21ca88311ec4fe27679cefd5');
  const c = fixture();
  const identity = acceptanceIdentity(c);
  assert.deepEqual(identity, {
    version: 1,
    contractDigest: 'cd5f9534ae411be3adc1a0a451c4982e64f2d8fb3f951a1373172ec182d1a4b9',
    probeDigest: '4de2262201b1d04f3fa0468541ab159f11435834c0366ccbd64ccdceaf2ab338',
    fixtureDigest: 'd7de8b81058cd4751ff81521de464aca7a3ca1a3e14e8b3e76bc1d05cef66ba5',
  });
  for (const hash of [identity.contractDigest, identity.probeDigest, identity.fixtureDigest]) assert.ok(markdown.includes(hash), 'documented identity stays current');
  const reverseKeys = (x: any): any => Array.isArray(x) ? x.map(reverseKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).reverse().map(k => [k, reverseKeys(x[k])])) : x;
  assert.deepEqual(acceptanceIdentity(c), acceptanceIdentity(reverseKeys(c)));
  assert.equal(canonicalAcceptanceJSON(c), canonicalAcceptanceJSON(fixture()));
  assert.notEqual(acceptanceHash(['a', 'b']), acceptanceHash(['b', 'a']));
  for (const change of [
    (c: AcceptanceContract) => c.revision++,
    (c: AcceptanceContract) => { c.criteria[0].behavior += ' '; },
    (c: AcceptanceContract) => { c.probes[0].bundle[0].sha256 = 'c'.repeat(64); },
    (c: AcceptanceContract) => { c.fixtures[0].sha256 = 'c'.repeat(64); },
    (c: AcceptanceContract) => { c.probes[0].bounds.timeoutMs++; },
    (c: AcceptanceContract) => { c.criteria[2].exception!.rationale += ' revised'; },
    (c: AcceptanceContract) => { c.criteria[0].evidenceRequirements.push('browser review'); },
  ]) {
    const changed = fixture(); change(changed);
    assert.notDeepEqual(acceptanceIdentity(changed), acceptanceIdentity(c));
    held(checkAcceptanceApproval(changed, ingress(c)), 'unapproved');
  }
  const parsed = validateAcceptanceContract(c); assert.equal(parsed.status, 'valid');
  if (parsed.status === 'valid') { c.criteria[0].behavior = 'mutated'; assert.notEqual(parsed.value.criteria[0].behavior, c.criteria[0].behavior); }
});

const invalidContracts: [string, (c: any) => void][] = [
  ['missing field', c => { delete c.criteria[0].behavior; }],
  ['missing ID', c => { delete c.assertions[0].id; }],
  ['unknown field', c => { c.approved = true; }],
  ['unknown nested field', c => { c.probes[0].bounds.shell = true; }],
  ['unknown version', c => { c.version = 2; }],
  ['unknown mode', c => { c.criteria[0].mode = 'green-is-fine'; }],
  ['no criteria', c => { c.criteria = []; }],
  ['duplicate criterion', c => { c.criteria.push(c.criteria[0]); }],
  ['duplicate assertion', c => { c.assertions.push(c.assertions[0]); }],
  ['duplicate probe', c => { c.probes.push(c.probes[0]); }],
  ['duplicate fixture', c => { c.fixtures.push(c.fixtures[0]); }],
  ['duplicate bundle path', c => { c.probes[0].bundle.push({ ...c.probes[0].bundle[0], id: 'B-other' }); }],
  ['missing assertion', c => { c.criteria[0].assertionIds = []; }],
  ['duplicate assertion ref', c => { c.criteria[0].assertionIds.push('A-summary'); }],
  ['multiply owned assertion', c => { c.criteria[1].assertionIds = ['A-summary']; }],
  ['unbound assertion', c => { c.criteria[0].assertionIds = ['A-absent']; }],
  ['unbound probe', c => { c.assertions[0].probeId = 'P-absent'; }],
  ['unbound fixture', c => { c.assertions[0].fixtureIds = ['F-absent']; }],
  ['probe does not supply fixture', c => { c.probes[0].fixtureIds = []; }],
  ['orphan assertion', c => { c.criteria.splice(0, 1); }],
  ['orphan probe', c => { c.probes.push({ ...c.probes[0], id: 'P-other' }); }],
  ['orphan fixture', c => { c.fixtures.push({ ...c.fixtures[0], id: 'F-other', path: 'fixtures/other.json' }); }],
  ['missing red name', c => { c.assertions[0].failureId = null; }],
  ['preservation with failure', c => { c.assertions[1].failureId = 'made-up'; }],
  ['changed green', c => { c.assertions[0].baseline = 'pass'; c.assertions[0].failureId = null; }],
  ['candidate red', c => { c.assertions[0].candidate = 'expected-behavioral-fail'; }],
  ['preservation red', c => { c.criteria[0].mode = 'preservation'; }],
  ['exception hides transition', c => { c.criteria[0].exception = c.criteria[2].exception; }],
  ['non-transition with assertions', c => { c.criteria[2].assertionIds = ['A-summary']; }],
  ['missing rationale', c => { c.criteria[2].exception.rationale = ''; }],
  ['missing approver', c => { c.criteria[2].exception.approver = ''; }],
  ['unknown exception', c => { c.criteria[2].exception.kind = 'waiver'; }],
  ['no evidence obligation', c => { c.criteria[2].evidenceRequirements = []; }],
  ['duplicate evidence obligation', c => { c.criteria[2].evidenceRequirements.push(c.criteria[2].evidenceRequirements[0]); }],
  ['empty argv', c => { c.probes[0].argv = []; }],
  ['empty executable', c => { c.probes[0].argv[0] = ''; }],
  ['NUL argv', c => { c.probes[0].argv.push('\0'); }],
  ['bad result protocol', c => { c.probes[0].protocol = 'exit-code'; }],
  ['bad artifact digest', c => { c.fixtures[0].sha256 = 'abc'; }],
  ['absolute artifact path', c => { c.fixtures[0].path = '/tmp/rows'; }],
  ['traversal path', c => { c.probes[0].bundle[0].path = '../outside'; }],
  ['windows path', c => { c.fixtures[0].path = 'C:\\rows'; }],
  ['fractional revision', c => { c.revision = 1.1; }],
  ['item bound', c => { c.probes[0].argv = Array(257).fill('arg'); }],
  ...(['timeoutMs', 'outputBytes', 'memoryMiB', 'cpus'] as const).flatMap(key => [
    [`zero ${key}`, (c: any) => { c.probes[0].bounds[key] = 0; }],
    [`unbounded ${key}`, (c: any) => { c.probes[0].bounds[key] = Number.MAX_SAFE_INTEGER; }],
    [`fractional ${key}`, (c: any) => { c.probes[0].bounds[key] = 1.5; }],
  ] as [string, (c: any) => void][]),
];
for (const [name, change] of invalidContracts) test(`schema rejects ${name}`, () => { const c = fixture(); change(c); held(validateAcceptanceContract(c), 'invalid-contract'); });

test('non-JSON and excessive content fail closed without invoking accessors', () => {
  const cycle: any = {}; cycle.self = cycle;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw Error('getter invoked'); } });
  const deep: any = []; let tail = deep; for (let i = 0; i < 35; i++) { tail.push([]); tail = tail[0]; }
  for (const x of [undefined, NaN, Infinity, 1n, new Date(), () => 1, cycle, getter, Object.defineProperty({}, 'hidden', { value: true }), Array(2), deep, 'x'.repeat(1024 * 1024 + 1), { [Symbol('x')]: 1 }]) {
    assert.throws(() => canonicalAcceptanceJSON(x)); held(validateAcceptanceContract(x), 'invalid-contract');
  }
  const c = fixture(); c.probes[0].argv.push(''); assert.equal(validateAcceptanceContract(c).status, 'valid');
});

test('trusted ingress is explicit; unbound, non-semantic and unavailable approval hold', () => {
  const c = fixture();
  for (const change of [
    (a: any) => { a.version = 2; },
    (a: any) => { delete a.provenance; },
    (a: any) => { a.trackerSaysApproved = true; },
    (a: any) => { a.identity.contractDigest = 'a'.repeat(64); },
    (a: any) => { a.identity.probeDigest = 'a'.repeat(64); },
    (a: any) => { a.identity.fixtureDigest = 'a'.repeat(64); },
    (a: any) => { a.approvedRevision++; },
    (a: any) => { a.semanticAdequacy = false; },
    (a: any) => { a.decision = 'deny'; },
    (a: any) => { a.decision = 'inconclusive'; },
    (a: any) => { a.reviewer.kind = 'implementer'; },
    (a: any) => { a.reviewer.name = 'another reviewer'; },
    (a: any) => { a.reviewedAt = '2026-02-30T00:00:00.000Z'; },
    (a: any) => { a.provenance = ''; },
  ]) { const a = approval(c); change(a); held(checkAcceptanceApproval(c, { lookup: () => a }), 'unapproved'); }
  held(checkAcceptanceApproval(c, { lookup: () => undefined }), 'unapproved');
  held(checkAcceptanceApproval(c, { lookup: () => { throw Error('private tracker stderr'); } }), 'unapproved');
  const a = approval(c); a.reviewer.kind = 'independent-reviewer'; assert.equal(checkAcceptanceApproval(c, { lookup: identity => { assert.ok(Object.isFrozen(identity)); assert.deepEqual(identity, a.identity); return a; } }).status, 'valid');
  const invalid = fixture(); invalid.version = 2 as any;
  held(checkAcceptanceApproval(invalid, { lookup: () => { assert.fail('invalid input must not consult authority'); } }), 'invalid-contract');
});

for (const status of ['harness-error', 'build-error', 'import-error', 'dependency-error', 'timeout', 'skipped', 'missing', 'unknown', 'inconsistent'] as AssertionStatus[]) {
  test(`${status} never counts as behavioral red or candidate green`, () => {
    const c = fixture();
    for (const phase of ['baseline', 'candidate'] as const) {
      const r = observed(c, phase); r.assertions[0].status = status; r.assertions[0].failureId = null;
      held(checkAcceptanceResults(c, ingress(c), r, phase), 'infrastructure');
      r.assertions[0].failureId = c.assertions[0].failureId;
      held(checkAcceptanceResults(c, ingress(c), r, phase), 'invalid-results');
    }
  });
}

test('already-green changed behavior holds distinctly, exact named red required, preservation stays green', () => {
  const c = fixture(); const r = observed(c, 'baseline');
  r.assertions[0].status = 'pass'; r.assertions[0].failureId = null;
  held(checkAcceptanceResults(c, ingress(c), r, 'baseline'), 'already-green');
  r.assertions[0].status = 'expected-behavioral-fail'; r.assertions[0].failureId = 'wrong-behavior';
  held(checkAcceptanceResults(c, ingress(c), r, 'baseline'), 'behavior-mismatch');
  r.assertions[0].failureId = c.assertions[0].failureId;
  r.assertions[1].status = 'expected-behavioral-fail'; r.assertions[1].failureId = 'wrong-behavior';
  held(checkAcceptanceResults(c, ingress(c), r, 'baseline'), 'behavior-mismatch');
  const candidate = observed(c, 'candidate'); candidate.assertions[0] = observed(c, 'baseline').assertions[0];
  held(checkAcceptanceResults(c, ingress(c), candidate, 'candidate'), 'behavior-mismatch');
});

for (const [name, change] of [
  ['missing assertion', (r: any) => { r.assertions.pop(); }],
  ['extra assertion', (r: any) => { r.assertions.push({ ...r.assertions[0], assertionId: 'extra' }); }],
  ['unknown assertion', (r: any) => { r.assertions[0].assertionId = 'unknown'; }],
  ['duplicate assertion', (r: any) => { r.assertions[1] = r.assertions[0]; }],
  ['unknown status', (r: any) => { r.assertions[0].status = 'exit-1'; }],
  ['inconsistent pass', (r: any) => { r.assertions[1].failureId = 'not-red'; }],
  ['unknown identity', (r: any) => { r.identity.contractDigest = 'a'.repeat(64); }],
  ['wrong phase', (r: any) => { r.phase = 'candidate'; }],
  ['unknown version', (r: any) => { r.version = 2; }],
  ['extra evidence obligation', (r: any) => { r.evidence[0].requirement = 'invented'; }],
  ['duplicate evidence obligation', (r: any) => { r.evidence.push(r.evidence[0]); }],
  ['unknown criterion evidence', (r: any) => { r.evidence[0].criterionId = 'unknown'; }],
  ['unknown result field', (r: any) => { r.success = true; }],
] as [string, (r: any) => void][]) test(`result reconciliation rejects ${name}`, () => { const c = fixture(); const r = observed(c, 'baseline'); change(r); held(checkAcceptanceResults(c, ingress(c), r, 'baseline'), 'invalid-results'); });

test('assertion and criterion evidence obligations remain explicit', () => {
  const c = fixture();
  const baseline = observed(c, 'baseline'); baseline.evidence = baseline.evidence.filter(e => e.criterionId === 'C-manual');
  assert.equal(checkAcceptanceResults(c, ingress(c), baseline, 'baseline').status, 'valid');
  baseline.assertions[0].evidence = []; held(checkAcceptanceResults(c, ingress(c), baseline, 'baseline'), 'missing-evidence');
  const candidate = observed(c, 'candidate'); candidate.evidence = candidate.evidence.filter(e => e.criterionId !== 'C-feature');
  held(checkAcceptanceResults(c, ingress(c), candidate, 'candidate'), 'missing-evidence');
  const stale = approval(c); c.criteria[0].behavior += ' edited';
  held(checkAcceptanceResults(c, { lookup: () => stale }, observed(c, 'candidate'), 'candidate'), 'unapproved');
});

test('import is silent under Node denied write/process/network capabilities', () => {
  const moduleURL = new URL('./acceptance-contract.mts', import.meta.url);
  const result = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${new URL('.', import.meta.url).pathname}`, '--input-type=module', '-e', `await import(${JSON.stringify(moduleURL.href)});`], { timeout: 5000, encoding: 'utf8', env: { PATH: '' } });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
