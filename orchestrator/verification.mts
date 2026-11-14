// Host-only verification contract (#150). Import-safe; proof roots are never agent mounts.
// Structural integrity is not semantic coverage: the independent verifier evaluates every requirement.
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync, realpathSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export interface Report {
  version: 1; verdict: Verdict; changeKind: 'feature' | 'bugfix'; evidenceKind: 'command' | 'browser' | 'mixed'; interactive: boolean;
  criteria: { requirement: string; result: 'pass' | 'fail' | 'inconclusive'; evidence: string[]; reason?: string }[];
  artifacts: { path: string; kind: 'command-output' | 'image' | 'video'; phase: 'before' | 'after' | 'check' }[];
  limitations: string[];
}
export type Artifact = Report['artifacts'][number] & { bytes: number; sha256: string };
export interface Identity {
  project: string; ticket: string; executionId: string; attemptId?: string; branch: string; base: string;
  baseline: string; tip: string; requirementsHash: string;
}
export interface Provenance { imageId: string; nodeVersion: string; code: Record<string, string>; settings: Record<string, unknown>; settingsHash?: string }
export interface Proof extends Identity {
  version: 1; id: string; verifiedAt: string; policyVersion: 1; report: Report;
  reportHash: string; verdictHash: string; artifacts: Artifact[]; provenance: Provenance;
}
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const demand = (ok: unknown, why: string): void => { if (!ok) throw new Error(`Verification refused: ${why}`); };
const text = (x: unknown): x is string => typeof x === 'string' && !!x.trim();
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string');
function keys(x: any, required: string[], optional: string[] = []) {
  demand(x && typeof x === 'object' && !Array.isArray(x), 'expected an object');
  demand(required.every(k => Object.hasOwn(x, k)) && Object.keys(x).every(k => [...required, ...optional].includes(k)), 'unknown or missing report keys');
}
export function validateReport(x: any): Report {
  keys(x, ['version', 'verdict', 'changeKind', 'evidenceKind', 'interactive', 'criteria', 'artifacts', 'limitations']);
  demand(x.version === 1 && ['PASS', 'FAIL', 'INCONCLUSIVE'].includes(x.verdict), 'unsupported report version/verdict');
  demand(['feature', 'bugfix'].includes(x.changeKind) && ['command', 'browser', 'mixed'].includes(x.evidenceKind) && typeof x.interactive === 'boolean', 'invalid evidence policy fields');
  demand(strings(x.limitations), 'limitations must be strings');
  demand(Array.isArray(x.criteria) && x.criteria.length > 0 && x.criteria.length <= 200, 'require 1–200 criteria');
  demand(Array.isArray(x.artifacts) && x.artifacts.length <= 128, 'maximum 128 artifacts');
  const paths = new Set<string>();
  for (const a of x.artifacts) {
    keys(a, ['path', 'kind', 'phase']);
    demand(text(a.path) && ['command-output', 'image', 'video'].includes(a.kind) && ['before', 'after', 'check'].includes(a.phase), 'invalid artifact');
    demand(!paths.has(a.path), 'duplicate artifact path'); paths.add(a.path);
  }
  for (const c of x.criteria) {
    keys(c, ['requirement', 'result', 'evidence'], ['reason']);
    demand(text(c.requirement) && ['pass', 'fail', 'inconclusive'].includes(c.result) && strings(c.evidence), 'invalid criterion');
    demand(c.reason === undefined || text(c.reason), 'invalid criterion reason');
    demand(c.evidence.every((p: string) => paths.has(p)), 'criterion references an unlisted artifact');
    demand(c.evidence.length > 0 || (c.result !== 'pass' && text(c.reason)), 'criterion needs evidence or a nonempty non-pass reason');
  }
  if (x.verdict === 'PASS') {
    demand(x.criteria.every((c: any) => c.result === 'pass') && x.artifacts.length > 0, 'PASS requires all criteria pass and artifacts');
    const has = (kind: string, phase?: string) => x.artifacts.some((a: any) => a.kind === kind && (!phase || a.phase === phase));
    if (x.evidenceKind !== 'command') {
      demand(has('image', 'after'), 'browser PASS needs an after image');
      if (x.changeKind === 'bugfix') demand(has('image', 'before'), 'browser bugfix needs a before image');
      if (x.interactive) demand(has('video'), 'interactive browser work needs video');
    }
    if (x.evidenceKind !== 'browser') {
      demand(has('command-output'), 'command PASS needs command-output evidence');
      if (x.changeKind === 'bugfix') demand(has('command-output', 'before') && has('command-output', 'after'), 'command bugfix needs before and after output');
    }
  }
  return x;
}
/** Reject symlinks in every component, even ones resolving back inside the root. */
function file(root: string, path: string): Buffer {
  demand(text(path) && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && path.split('/').every(p => p && p !== '.' && p !== '..'), 'unsafe artifact path');
  let at = resolve(root);
  demand(!lstatSync(at).isSymbolicLink(), 'symlink evidence root');
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]);
    const s = lstatSync(at);
    demand(!s.isSymbolicLink() && (i === parts.length - 1 ? s.isFile() : s.isDirectory()), 'symlink or nonregular evidence');
  }
  const data = readFileSync(at); demand(data.length > 0, `empty evidence: ${path}`); return data;
}
export function validateEvidence(root: string) {
  const reportBytes = file(root, 'verification.json');
  demand(reportBytes.length <= 1024 * 1024, 'report exceeds 1 MiB');
  const report = validateReport(JSON.parse(reportBytes.toString('utf8')));
  const verdictBytes = file(root, 'verdict.md');
  const first = verdictBytes.toString('utf8').replaceAll('\r\n', '\n').split('\n')[0];
  demand(first === `VERDICT: ${report.verdict}`, 'verdict.md first line must exactly match verification.json');
  const artifacts: Artifact[] = report.artifacts.map(a => {
    demand(!['verdict.md', 'verification.json', 'browser-preflight.log'].includes(a.path.split('/').at(-1)!), 'reserved diagnostic is not acceptance evidence');
    if (a.kind === 'image') demand(a.path.endsWith('.png'), 'images must be PNG');
    if (a.kind === 'video') demand(/\.(webm|mp4)$/.test(a.path), 'videos must be WebM or MP4');
    const bytes = file(root, a.path); return { ...a, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return { report, artifacts, reportHash: sha256(reportBytes), verdictHash: sha256(verdictBytes), verdictText: verdictBytes.toString('utf8') };
}
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40,64}$/;
function checkIdentity(i: Identity) {
  demand([i.project, i.ticket, i.executionId, i.branch, i.base].every(text) && SHA.test(i.baseline) && SHA.test(i.tip) && /^(?:[0-9a-f]{16}|[0-9a-f]{64})$/.test(i.requirementsHash), 'missing execution identity, requirements hash or recorded baseline/tip');
  demand(i.attemptId === undefined || ID.test(i.attemptId), 'invalid recovery attempt identity');
}
/** Refuse configuration that would expose host authority through any writable or read-only agent mount. */
export function assertProofStoreOutsideMounts(state: string, mounts: string[]) {
  const physical = (path: string): string => {
    const absolute = resolve(path);
    if (existsSync(absolute)) return realpathSync(absolute);
    return join(physical(dirname(absolute)), basename(absolute));
  };
  const store = physical(resolve(state, 'verification'));
  for (const mount of mounts) {
    const root = physical(mount);
    demand(store !== root && !store.startsWith(root + '/') && !root.startsWith(store + '/'), 'proof store overlaps an agent mount');
  }
}
export const proofRoot = (state: string, project: string, ticket: string, id: string) => {
  demand(ID.test(id), 'invalid proof id');
  // The run key is constructed, not taken from agent metadata; no caller-controlled paths.
  return resolve(state, 'verification', `${sha256(project)}--${encodeURIComponent(ticket)}`, id);
};
/** Call only after verifier immutability checks and confirmed sandbox teardown. */
export function createProof(state: string, evidence: string, identity: Identity, provenance: Provenance) {
  checkIdentity(identity);
  assertProofStoreOutsideMounts(state, [evidence]);
  demand(/^sha256:[0-9a-f]{64}$/.test(provenance.imageId) && text(provenance.nodeVersion), 'missing immutable image ID or verifier Node version');
  const validated = validateEvidence(evidence), id = randomUUID(), root = proofRoot(state, identity.project, identity.ticket, id);
  const staging = root + '.tmp';
  demand(!resolve(evidence).startsWith(resolve(state, 'verification') + '/'), 'evidence must be separate from proof storage');
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  for (const path of ['verification.json', 'verdict.md', ...validated.artifacts.map(a => a.path)]) {
    const target = join(staging, path); mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file(evidence, path), { flag: 'wx', mode: 0o400 });
  }
  const { report, artifacts, reportHash, verdictHash } = validateEvidence(staging);
  demand(reportHash === validated.reportHash && verdictHash === validated.verdictHash && JSON.stringify(artifacts) === JSON.stringify(validated.artifacts), 'evidence changed while freezing');
  const proof: Proof = { version: 1, id, ...identity, verifiedAt: new Date().toISOString(), policyVersion: 1, report, reportHash, verdictHash, artifacts, provenance: { ...provenance, settingsHash: sha256(JSON.stringify(provenance.settings)) } };
  writeFileSync(join(staging, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  renameSync(staging, root);
  return { id, root, proof };
}
/** Read-only contract for delivery/continuations: resolve by identity/id, rehash every frozen artifact. */
export function readProof(state: string, identity: Identity, id: string) {
  checkIdentity(identity);
  const root = proofRoot(state, identity.project, identity.ticket, id);
  const proof: Proof = JSON.parse(file(root, 'proof.json').toString('utf8'));
  demand(proof.version === 1 && proof.policyVersion === 1 && proof.id === id, 'unsupported proof');
  for (const k of ['project', 'ticket', 'executionId', 'attemptId', 'branch', 'base', 'baseline', 'tip', 'requirementsHash'] as const)
    demand(proof[k] === identity[k], `proof identity mismatch: ${k}`);
  demand(proof.provenance?.settingsHash === sha256(JSON.stringify(proof.provenance?.settings)), 'proof settings integrity mismatch');
  const v = validateEvidence(root);
  demand(v.reportHash === proof.reportHash && v.verdictHash === proof.verdictHash && JSON.stringify(v.artifacts) === JSON.stringify(proof.artifacts) && JSON.stringify(v.report) === JSON.stringify(proof.report), 'proof integrity mismatch');
  return { root, proof, ...v };
}
