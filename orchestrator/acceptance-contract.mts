// Pure portable acceptance inventory, exact-content approval binding and assertion transition policy.
// Structural satisfaction is not semantic approval, execution authorization or delivery proof.
import { createHash } from 'node:crypto';

export const ACCEPTANCE_VERSION = 1;
export const ACCEPTANCE_LIMITS = Object.freeze({ bytes: 1024 * 1024, items: 256, timeoutMs: 300_000, outputBytes: 1024 * 1024, memoryMiB: 8192, cpus: 8 });
export type Digest = string;
export interface Artifact { id: string; path: string; sha256: Digest }
export interface Probe {
  id: string; bundle: Artifact[]; argv: string[]; fixtureIds: string[];
  protocol: 'assertions-v1'; bounds: { timeoutMs: number; outputBytes: number; memoryMiB: number; cpus: number };
}
export interface Assertion {
  id: string; behavior: string; input: string; fixtureIds: string[]; probeId: string;
  baseline: 'pass' | 'expected-behavioral-fail'; candidate: 'pass';
  /** Named failure is required only for changed assertions; infrastructure failure is never red. */
  failureId: string | null;
}
export type NonTransitionKind = 'documentation-only' | 'refactor' | 'investigation' | 'manual';
export interface Criterion {
  id: string; behavior: string; mode: 'changed' | 'preservation' | 'non-transition';
  assertionIds: string[]; evidenceRequirements: string[];
  exception: { kind: NonTransitionKind; rationale: string; approver: string } | null;
}
export interface AcceptanceContract {
  version: 1; id: string; revision: number; criteria: Criterion[]; assertions: Assertion[];
  probes: Probe[]; fixtures: Artifact[];
}
export interface AcceptanceIdentity {
  version: 1; contractDigest: Digest; probeDigest: Digest; fixtureDigest: Digest;
}
export interface ApprovalRecord {
  version: 1; id: string; identity: AcceptanceIdentity; approvedRevision: number;
  reviewer: { kind: 'human' | 'independent-reviewer'; name: string };
  decision: 'approve' | 'deny' | 'inconclusive'; semanticAdequacy: boolean;
  provenance: string; reviewedAt: string;
}
/** Only the host's authenticated, access-controlled record store may implement this ingress.
 * Never implement it using tracker assertions of approval or candidate-owned files. The callback
 * is an explicit trust boundary, not authentication implemented by this pure module. */
export interface TrustedApprovalIngress { lookup(identity: Readonly<AcceptanceIdentity>): unknown }
export type HoldCode = 'invalid-contract' | 'unapproved' | 'invalid-results' | 'infrastructure' | 'already-green' | 'behavior-mismatch' | 'missing-evidence';
export interface AcceptanceHold { status: 'hold'; code: HoldCode; path: string; reason: string; nextActor: 'preparer-or-reviewer' }
export type Check<T> = { status: 'valid'; value: T } | AcceptanceHold;
export type AssertionStatus = 'pass' | 'expected-behavioral-fail' | 'harness-error' | 'build-error' | 'import-error' | 'dependency-error' | 'timeout' | 'skipped' | 'missing' | 'unknown' | 'inconsistent';
export interface AssertionResult { assertionId: string; status: AssertionStatus; failureId: string | null; evidence: string[] }
/** Runner-owned observations; receipt/custody/SHA authentication belongs to the host runner. */
export interface ResultEnvelope {
  version: 1; phase: 'baseline' | 'candidate'; identity: AcceptanceIdentity;
  assertions: AssertionResult[]; evidence: { criterionId: string; requirement: string; reference: string }[];
}

class Invalid extends Error {
  path: string;
  constructor(path: string, reason: string) { super(reason); this.path = path; }
}
const need = (ok: unknown, path: string, reason: string): void => { if (!ok) throw new Invalid(path, reason); };
const plain = (v: any) => v !== null && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const record = (v: any, keys: string[], p: string) => need(plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)), p, 'unknown or missing fields');
const text = (v: any, p: string, max = 4000) => need(typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0'), p, 'expected bounded nonempty text');
const id = (v: any, p: string) => need(typeof v === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(v), p, 'invalid stable ID');
const digest = (v: any, p: string) => need(typeof v === 'string' && /^[a-f0-9]{64}$/.test(v), p, 'expected SHA-256');
const integer = (v: any, max: number, p: string) => need(Number.isSafeInteger(v) && v > 0 && v <= max, p, 'invalid bound');
const list = (v: any, p: string, empty = false) => need(Array.isArray(v) && v.length <= ACCEPTANCE_LIMITS.items && (empty || v.length > 0), p, 'invalid bounded inventory');
const unique = (values: any[], p: string) => need(new Set(values).size === values.length, p, 'duplicate IDs or references');
const refs = (v: any, p: string, empty = false) => { list(v, p, empty); v.forEach((s: any) => id(s, p)); unique(v, p); };
const hold = (code: HoldCode, e: unknown): AcceptanceHold => ({ status: 'hold', code, path: e instanceof Invalid ? e.path : '$', reason: e instanceof Invalid ? e.message : 'unavailable or non-JSON input', nextActor: 'preparer-or-reviewer' });

/** Canonical JSON: object keys sorted by UTF-16 code units; array order and exact text significant.
 * Reject cycles, non-JSON values, sparse arrays, accessors and excessive depth/bytes. */
export function canonicalAcceptanceJSON(value: unknown): string {
  const seen = new Set<object>();
  let bytes = 0;
  const add = (s: string) => { bytes += Buffer.byteLength(s); need(bytes <= ACCEPTANCE_LIMITS.bytes, '$', 'content byte limit'); return s; };
  const encode = (v: any, depth: number): string => {
    need(depth <= 32, '$', 'content depth limit');
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return add(JSON.stringify(v));
    need(Array.isArray(v) || plain(v), '$', 'not JSON data');
    need(!seen.has(v), '$', 'cyclic content'); seen.add(v);
    const keys = Object.keys(v);
    need(Object.getOwnPropertySymbols(v).length === 0 && Object.getOwnPropertyNames(v).length === keys.length + (Array.isArray(v) ? 1 : 0) && keys.every(k => 'value' in Object.getOwnPropertyDescriptor(v, k)!), '$', 'non-JSON properties');
    let result: string;
    if (Array.isArray(v)) {
      need(keys.length === v.length && keys.every((k, i) => k === String(i)), '$', 'sparse or extended array');
      result = add('[') + v.map((x: any) => encode(x, depth + 1)).join(add(',')) + add(']');
    } else result = add('{') + keys.sort().map(k => add(JSON.stringify(k) + ':') + encode(v[k], depth + 1)).join(add(',')) + add('}');
    seen.delete(v); return result;
  };
  const result = encode(value, 0);
  need(Buffer.byteLength(result) <= ACCEPTANCE_LIMITS.bytes, '$', 'content byte limit');
  return result;
}
export const acceptanceHash = (value: unknown): Digest => createHash('sha256').update(canonicalAcceptanceJSON(value)).digest('hex');
/** Snapshot into inert JSON before validation so returned content cannot share mutable input aliases. */
const snapshot = (value: unknown): any => JSON.parse(canonicalAcceptanceJSON(value));
const artifact = (a: any, p: string) => {
  record(a, ['id', 'path', 'sha256'], p); id(a.id, p); digest(a.sha256, p);
  text(a.path, p, 1024);
  need(!a.path.includes('\\') && !a.path.includes(':') && a.path.split('/').every((s: string) => s && s !== '.' && s !== '..'), p, 'nonportable artifact path');
};
function parseContract(x: any): AcceptanceContract {
  record(x, ['version', 'id', 'revision', 'criteria', 'assertions', 'probes', 'fixtures'], '$');
  need(x.version === 1, '$.version', 'unsupported version'); id(x.id, '$.id'); integer(x.revision, Number.MAX_SAFE_INTEGER, '$.revision');
  for (const k of ['criteria', 'assertions', 'probes', 'fixtures']) {
    list(x[k], `$.${k}`, k !== 'criteria');
    x[k].forEach((v: any) => id(v?.id, `$.${k}.id`)); unique(x[k].map((v: any) => v.id), `$.${k}`);
  }
  x.fixtures.forEach((a: any) => artifact(a, '$.fixtures'));
  unique(x.fixtures.map((a: any) => a.path), '$.fixtures.path');
  const fixtureIds = new Set(x.fixtures.map((a: any) => a.id));
  const checkFixtures = (ids: any, p: string) => { refs(ids, p, true); need(ids.every((i: string) => fixtureIds.has(i)), p, 'unbound fixture'); };
  for (const p of x.probes) {
    record(p, ['id', 'bundle', 'argv', 'fixtureIds', 'protocol', 'bounds'], '$.probes');
    list(p.bundle, '$.probes.bundle'); p.bundle.forEach((a: any) => artifact(a, '$.probes.bundle'));
    unique(p.bundle.map((a: any) => a.id), '$.probes.bundle.id'); unique(p.bundle.map((a: any) => a.path), '$.probes.bundle.path');
    list(p.argv, '$.probes.argv'); p.argv.forEach((arg: any) => { need(typeof arg === 'string' && arg.length <= 4000 && !arg.includes('\0'), '$.probes.argv', 'invalid literal argv'); });
    text(p.argv[0], '$.probes.argv[0]'); checkFixtures(p.fixtureIds, '$.probes.fixtureIds');
    need(p.protocol === 'assertions-v1', '$.probes.protocol', 'unsupported result protocol');
    record(p.bounds, ['timeoutMs', 'outputBytes', 'memoryMiB', 'cpus'], '$.probes.bounds');
    for (const key of ['timeoutMs', 'outputBytes', 'memoryMiB', 'cpus'] as const) integer(p.bounds[key], ACCEPTANCE_LIMITS[key], `$.probes.bounds.${key}`);
  }
  for (const a of x.assertions) {
    record(a, ['id', 'behavior', 'input', 'fixtureIds', 'probeId', 'baseline', 'candidate', 'failureId'], '$.assertions');
    text(a.behavior, '$.assertions.behavior'); text(a.input, '$.assertions.input'); checkFixtures(a.fixtureIds, '$.assertions.fixtureIds');
    id(a.probeId, '$.assertions.probeId');
    const probe = x.probes.find((p: any) => p.id === a.probeId);
    need(probe && a.fixtureIds.every((i: string) => probe.fixtureIds.includes(i)), '$.assertions.probeId', 'unbound probe or fixture');
    need(['pass', 'expected-behavioral-fail'].includes(a.baseline) && a.candidate === 'pass', '$.assertions', 'invalid expected transition');
    if (a.baseline === 'expected-behavioral-fail') id(a.failureId, '$.assertions.failureId');
    else need(a.failureId === null, '$.assertions.failureId', 'preservation cannot name red');
  }
  const used = new Set<string>();
  for (const c of x.criteria) {
    record(c, ['id', 'behavior', 'mode', 'assertionIds', 'evidenceRequirements', 'exception'], '$.criteria');
    text(c.behavior, '$.criteria.behavior');
    need(['changed', 'preservation', 'non-transition'].includes(c.mode), '$.criteria.mode', 'unknown mode');
    refs(c.assertionIds, '$.criteria.assertionIds', c.mode === 'non-transition');
    list(c.evidenceRequirements, '$.criteria.evidenceRequirements'); c.evidenceRequirements.forEach((r: any) => text(r, '$.criteria.evidenceRequirements')); unique(c.evidenceRequirements, '$.criteria.evidenceRequirements');
    if (c.mode === 'non-transition') {
      need(c.assertionIds.length === 0, '$.criteria.assertionIds', 'non-transition has evidence, not executable transitions');
      record(c.exception, ['kind', 'rationale', 'approver'], '$.criteria.exception');
      need(['documentation-only', 'refactor', 'investigation', 'manual'].includes(c.exception.kind), '$.criteria.exception.kind', 'unknown exception');
      text(c.exception.rationale, '$.criteria.exception.rationale'); text(c.exception.approver, '$.criteria.exception.approver');
    } else need(c.exception === null, '$.criteria.exception', 'transition cannot carry an exception');
    for (const aid of c.assertionIds) {
      const a = x.assertions.find((a: any) => a.id === aid);
      need(a && !used.has(aid), '$.criteria.assertionIds', 'unbound or multiply owned assertion'); used.add(aid);
      need(a.baseline === (c.mode === 'changed' ? 'expected-behavioral-fail' : 'pass'), '$.criteria.mode', 'mode and transition disagree');
    }
  }
  need(used.size === x.assertions.length, '$.assertions', 'orphan assertion');
  need(x.probes.every((p: any) => x.assertions.some((a: any) => a.probeId === p.id)), '$.probes', 'orphan probe');
  need(x.fixtures.every((f: any) => x.probes.some((p: any) => p.fixtureIds.includes(f.id))), '$.fixtures', 'orphan fixture');
  return x;
}
export function validateAcceptanceContract(value: unknown): Check<AcceptanceContract> {
  try { return { status: 'valid', value: parseContract(snapshot(value)) }; } catch (e) { return hold('invalid-contract', e); }
}
/** Throws for malformed content. Approval is deliberately excluded from all content digests. */
export function acceptanceIdentity(value: AcceptanceContract): AcceptanceIdentity {
  const c = parseContract(snapshot(value));
  return { version: 1, contractDigest: acceptanceHash(c), probeDigest: acceptanceHash(c.probes), fixtureDigest: acceptanceHash(c.fixtures) };
}
function checkIdentity(x: any) {
  record(x, ['version', 'contractDigest', 'probeDigest', 'fixtureDigest'], '$.identity');
  need(x.version === 1, '$.identity.version', 'unsupported identity version');
  for (const k of ['contractDigest', 'probeDigest', 'fixtureDigest']) digest(x[k], `$.identity.${k}`);
}
/** This checks binding and the trusted record's declared decision, never English adequacy. */
export function checkAcceptanceApproval(value: unknown, ingress: TrustedApprovalIngress): Check<{ contract: AcceptanceContract; identity: AcceptanceIdentity; approval: ApprovalRecord }> {
  const parsed = validateAcceptanceContract(value); if (parsed.status === 'hold') return parsed;
  try {
    const contract = parsed.value, identity = acceptanceIdentity(contract);
    const a = snapshot(ingress.lookup(Object.freeze({ ...identity })));
    record(a, ['version', 'id', 'identity', 'approvedRevision', 'reviewer', 'decision', 'semanticAdequacy', 'provenance', 'reviewedAt'], '$.approval');
    need(a.version === 1, '$.approval.version', 'unsupported approval version'); id(a.id, '$.approval.id'); checkIdentity(a.identity);
    need(acceptanceHash(a.identity) === acceptanceHash(identity) && a.approvedRevision === contract.revision, '$.approval.identity', 'approval does not bind exact content and revision');
    record(a.reviewer, ['kind', 'name'], '$.approval.reviewer');
    need(['human', 'independent-reviewer'].includes(a.reviewer.kind), '$.approval.reviewer.kind', 'unsupported reviewer'); text(a.reviewer.name, '$.approval.reviewer.name');
    need(a.decision === 'approve' && a.semanticAdequacy === true, '$.approval.decision', 'independent semantic approval required');
    text(a.provenance, '$.approval.provenance');
    need(typeof a.reviewedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(a.reviewedAt) && Number.isFinite(Date.parse(a.reviewedAt)) && new Date(a.reviewedAt).toISOString() === a.reviewedAt, '$.approval.reviewedAt', 'invalid review timestamp');
    need(contract.criteria.every(c => !c.exception || c.exception.approver === a.reviewer.name), '$.criteria.exception.approver', 'exception approver not bound to reviewer');
    return { status: 'valid', value: { contract, identity, approval: a } };
  } catch (e) { return hold('unapproved', e); }
}

const STATUSES: AssertionStatus[] = ['pass', 'expected-behavioral-fail', 'harness-error', 'build-error', 'import-error', 'dependency-error', 'timeout', 'skipped', 'missing', 'unknown', 'inconsistent'];
/** Reconcile one phase against the full inventory. Run for both phases with identical identity.
 * A valid result is only structural policy satisfaction, not proof or semantic verifier PASS. */
export function checkAcceptanceResults(value: unknown, ingress: TrustedApprovalIngress, observed: unknown, phase: 'baseline' | 'candidate'): Check<ResultEnvelope> {
  const approved = checkAcceptanceApproval(value, ingress); if (approved.status === 'hold') return approved;
  const { contract, identity } = approved.value;
  let r: ResultEnvelope;
  try {
    r = snapshot(observed); record(r, ['version', 'phase', 'identity', 'assertions', 'evidence'], '$.results');
    need(r.version === 1 && ['baseline', 'candidate'].includes(phase) && r.phase === phase, '$.results.phase', 'unsupported version or phase');
    checkIdentity(r.identity); need(acceptanceHash(r.identity) === acceptanceHash(identity), '$.results.identity', 'different content identity');
    list(r.assertions, '$.results.assertions', true); unique(r.assertions.map(a => a.assertionId), '$.results.assertions');
    need(r.assertions.length === contract.assertions.length, '$.results.assertions', 'missing or extra assertions');
    for (const a of r.assertions) {
      record(a, ['assertionId', 'status', 'failureId', 'evidence'], '$.results.assertions');
      need(contract.assertions.some(expected => expected.id === a.assertionId) && STATUSES.includes(a.status), '$.results.assertions', 'unknown assertion or status');
      list(a.evidence, '$.results.assertions.evidence', true); a.evidence.forEach(e => text(e, '$.results.assertions.evidence'));
      if (a.status === 'expected-behavioral-fail') id(a.failureId, '$.results.assertions.failureId');
      else need(a.failureId === null, '$.results.assertions.failureId', 'inconsistent failure classification');
    }
    list(r.evidence, '$.results.evidence', true);
    for (const e of r.evidence) {
      record(e, ['criterionId', 'requirement', 'reference'], '$.results.evidence'); text(e.reference, '$.results.evidence.reference');
      need(contract.criteria.some(c => c.id === e.criterionId && c.evidenceRequirements.includes(e.requirement)), '$.results.evidence', 'unknown evidence obligation');
    }
    unique(r.evidence.map(e => JSON.stringify([e.criterionId, e.requirement])), '$.results.evidence');
  } catch (e) { return hold('invalid-results', e); }
  for (const a of contract.assertions) {
    const actual = r.assertions.find(result => result.assertionId === a.id)!;
    if (!['pass', 'expected-behavioral-fail'].includes(actual.status)) return hold('infrastructure', new Invalid(a.id, actual.status));
    const expected = phase === 'baseline' ? a.baseline : a.candidate;
    if (phase === 'baseline' && expected === 'expected-behavioral-fail' && actual.status === 'pass') return hold('already-green', new Invalid(a.id, 'changed behavior already green; independent review required, never synthesize red or change mode'));
    if (actual.status !== expected || actual.status === 'expected-behavioral-fail' && actual.failureId !== a.failureId) return hold('behavior-mismatch', new Invalid(a.id, 'not the named expected behavioral outcome'));
    if (!actual.evidence.length) return hold('missing-evidence', new Invalid(a.id, 'assertion evidence required'));
  }
  // Candidate obligations include all modes. Non-transition evidence is required in either phase.
  for (const c of contract.criteria.filter(c => phase === 'candidate' || c.mode === 'non-transition')) {
    for (const requirement of c.evidenceRequirements) if (!r.evidence.some(e => e.criterionId === c.id && e.requirement === requirement)) return hold('missing-evidence', new Invalid(c.id, 'criterion evidence obligation missing'));
  }
  return { status: 'valid', value: r };
}
