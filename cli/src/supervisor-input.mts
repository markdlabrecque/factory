// Read-only complete saved-execution diagnosis collection. Freezes originals privately; never admits, settles or sends.
import { execFileSync } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import type { AdmissionState } from '../../board/admission.mts';
import type { HoldKey } from './supervisor-admission.mts';
import type { AttemptRecord } from '../../orchestrator/recovery.mts';
import type { ExecutionContext } from '../../orchestrator/context.mts';
import type { Source, Snapshot, ProjectIdentity } from '../../orchestrator/supervisor-contract.mts';
import type { TicketContextSource } from '../../orchestrator/ticket-context.mts';
import type { Facts, SupervisorState } from './supervisor-state.mts';
import { collectSupervisorTicketInput, supervisorReviewSnapshot } from './supervisor-facts.mts';
import { emptySupervisor, validateSupervisor } from './supervisor-state.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { supervisorHash, sourceHash, validateReviewInput } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
const { ticketContextHash } = await import(flat ? './ticket-context.mts' : '../../orchestrator/ticket-context.mts');
const { diagnosisBasis } = await import(flat ? './supervisor.mts' : '../../orchestrator/supervisor.mts');
const { requireProjectLayout } = await import(flat ? './project-layout.mts' : '../../orchestrator/project-layout.mts');
const { keyFor, admissionConflict, migrateAdmission } = await import(flat ? './admission.mts' : '../../board/admission.mts');
const { projectId, receiptFile, canonicalWorktree } = await import(flat ? './ownership.mts' : '../../orchestrator/ownership.mts');
const { decodeAttemptRecord, attemptEvidence, attemptGitDir } = await import(flat ? './recovery.mts' : '../../orchestrator/recovery.mts');
const { validateReport } = await import(flat ? './verification.mts' : '../../orchestrator/verification.mts');
const { normalizedSettings } = await import(flat ? './context.mts' : '../../orchestrator/context.mts');
const { MODEL_POLICY, MODEL_POLICY_ID, AGENT_POLICY } = await import(flat ? './model-policy.mts' : '../../orchestrator/model-policy.mts');
const MAX = 262144;
const hold = (reason: string): never => { throw Error(`Supervisor input held: ${reason}. Preserve saved work; obtain complete current originals before diagnosis.`); };
const inside = (root: string, file: string) => { const r = relative(root, file); return !r || !r.startsWith(`..${sep}`) && r !== '..' && !r.startsWith('/'); };
/** Bounded stable original read; refuses every path alias, special file and invalid UTF-8, not just final symlinks. */
export function readSupervisorOriginal(file: string, max = MAX): string {
  if (resolve(file) !== file || realpathSync(file) !== file) return hold(`aliased original ${file}`);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd), named = lstatSync(file);
    if (!before.isFile() || before.size > max || before.dev !== named.dev || before.ino !== named.ino) return hold(`unsafe/oversized original ${file} (limit ${max} bytes)`);
    const b = Buffer.alloc(max + 1); let n = 0, read = 0;
    while ((read = readSync(fd, b, n, b.length - n, null)) > 0) { n += read; if (n > max) return hold(`oversized original ${file}`); }
    const after = fstatSync(fd), current = lstatSync(file);
    if (before.size !== n || before.size !== after.size || before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs
      || current.ino !== before.ino || current.dev !== before.dev || realpathSync(file) !== file) return hold(`original changed while reading ${file}`);
    const bytes = b.subarray(0, n), text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes) || text.includes('\0')) return hold(`non-text original ${file}`);
    return text;
  } finally { closeSync(fd); }
}
/** Deliberately separate from legacy readiness Git: every call has a hard deadline and cannot refresh the index. */
export function supervisorInputGit(root: string, args: string[]): string {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false', ...args], {
    cwd: root, encoding: 'utf8', timeout: 1500, maxBuffer: MAX, killSignal: 'SIGKILL', stdio: ['ignore','pipe','pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_EXTERNAL_DIFF: '', GIT_CONFIG_COUNT: '0' },
  }).trim();
}
const original = (role: Source['role'], locator: string, text: string, status: Source['status'] = 'complete'): Source => {
  if (Buffer.byteLength(text) > MAX || status === 'complete' && !text.trim()) return hold(`missing/oversized ${role}: ${locator}`);
  return { role, locator, text, status, sha256: sourceHash(text) };
};
/** Locate a JSON member's exact bytes, preserving formatting rather than reserializing an authoritative decision. */
function member(raw: string, path: string[]): string {
  let i = 0; const spans = new Map<string,string>();
  const ws = () => { while (/\s/.test(raw[i] ?? '') && i < raw.length) i++; };
  function value(p: string[]): void {
    ws(); const start = i;
    if (raw[i] === '{') {
      i++; ws();
      while (raw[i] !== '}') {
        const k = i; string(); const key = JSON.parse(raw.slice(k, i)); ws(); if (raw[i++] !== ':') return hold('invalid decision JSON');
        value([...p,key]); ws(); if (raw[i] !== ',') break; i++; ws();
      }
      if (raw[i++] !== '}') return hold('invalid decision JSON');
    } else if (raw[i] === '[') {
      i++; ws(); let n = 0;
      while (raw[i] !== ']') { value([...p,String(n++)]); ws(); if (raw[i] !== ',') break; i++; ws(); }
      if (raw[i++] !== ']') return hold('invalid decision JSON');
    } else if (raw[i] === '"') string();
    else { while (i < raw.length && !/[\s,}\]]/.test(raw[i])) i++; }
    spans.set(JSON.stringify(p), raw.slice(start,i));
  }
  function string(): void { if (raw[i++] !== '"') return hold('invalid decision key'); while (i < raw.length) { const c = raw[i++]; if (c === '\\') i++; else if (c === '"') return; } return hold('unterminated decision string'); }
  JSON.parse(raw); value([]);
  return spans.get(JSON.stringify(path)) ?? hold('missing authoritative decision bytes');
}
/** Complete authoritative subset only. Observation/charge/history/diagnosis publication is intentionally excluded. */
export function supervisorDecisionSources(raw: string | null, project: ProjectIdentity, ticket: number, cutoff: string): Source[] {
  if (raw === null) return [original('prior-decisions', 'supervisor:authoritative-decisions', '', 'not-applicable')];
  const journal = JSON.parse(raw), rootKey = supervisorHash(project.root);
  if (journal.version !== 1 || !journal.projects || Array.isArray(journal.projects) || typeof journal.projects !== 'object'
    || Object.keys(journal.projects).some(k => !/^[a-f0-9]{64}$/.test(k)) || Object.keys(journal).sort().join() !== 'projects,version') return hold('unsupported decision journal');
  const state: SupervisorState = Object.hasOwn(journal.projects,rootKey) ? validateSupervisor(journal.projects[rootKey], project) : emptySupervisor(project);
  const selected: { id: string; text: string }[] = [];
  for (const [id, review] of Object.entries(state.reviews)) {
    const proposal = state.proposals[review.proposalId];
    if (proposal.scope.kind === 'ticket' && proposal.scope.ticket !== ticket) continue;
    if (review.completedAt > cutoff || !state.reviewCompletions?.[id]) return hold('relevant independent review lacks current host provenance');
    selected.push({ id: `review:${id}`, text: member(raw,['projects',rootKey,'reviews',id]) });
    selected.push({ id: `review-provenance:${id}`, text: member(raw,['projects',rootKey,'reviewCompletions',id]) });
  }
  for (const [id, resolution] of Object.entries(state.resolutions ?? {})) {
    const scope = state.incidents[id].facts.scope;
    if (scope.kind === 'ticket' && scope.ticket !== ticket) continue;
    if (resolution.at > cutoff) return hold('human resolution is after collection cutoff');
    selected.push({ id: `resolution:${id}`, text: member(raw,['projects',rootKey,'resolutions',id]) });
  }
  return selected.length ? selected.sort((a,b) => a.id.localeCompare(b.id) || a.text.localeCompare(b.text))
    .map(s => original('prior-decisions', `supervisor:${s.id}`, s.text)) : [original('prior-decisions','supervisor:authoritative-decisions','','not-applicable')];
}
/** Immutable admission projection: only an explicitly expected exact own hold may be excluded.
 * No admission transaction, dead-owner pruning, capacity assertion or permission is performed. */
export function supervisorInputOwnership(admission: AdmissionState, project: ProjectIdentity, expected?: HoldKey) {
  const generation = admission.generations[project.tracker.project];
  if (!Number.isSafeInteger(generation)) return hold('missing definitive admission generation');
  const conflicts = (p: ProjectIdentity) => admissionConflict({ ...p, root: realpathSync(p.root) },project);
  if (expected) {
    const actual = admission.supervisorHolds[expected.id];
    const identity = (h: HoldKey) => ({ id:h.id, project:h.project, invocationId:h.invocationId, fence:h.fence, owner:h.owner });
    if (!actual || !expected.owner.start || supervisorHash(expected.project) !== supervisorHash(project)
      || supervisorHash(identity(actual)) !== supervisorHash(identity(expected))) return hold('expected own supervisor hold missing/mismatched');
  }
  const foreign = Object.values(admission.supervisorHolds).filter(h => h.id !== expected?.id && conflicts(h.project));
  if (foreign.length) return hold('conflicting foreign supervisor hold retains project ownership');
  const entries = Object.values(admission.entries).filter(e => conflicts(e.project));
  const claims = Object.values(admission.claims).filter(e => keyFor('',e.project) === keyFor('',project.tracker.project));
  const recovery = admission.recovery[project.tracker.project] ?? null;
  if (entries.length || claims.length || recovery?.pending.length) return hold('managed entry/claim/unsettled recovery retains project ownership');
  return { generation, entries, claims, recovery };
}
export type SupervisorInputOptions = {
  context: ExecutionContext; registry: string; ticket: number; observedAt: string;
  /** Host destination only, outside checkout AND selected runtime/agent mounts. Must already be private. */
  output: string;
  /** Exhaustive read-only adapter; production callers use commandContextSource's bounded transport. */
  tracker: TicketContextSource;
  /** Exact host-held identity, revalidated on both immutable admission reads. Absent means no own exclusion. */
  expectedOwnHold?: HoldKey;
};
/** Rebuild BEFORE comparing a cache. No cached snapshot, summaries, quiescence booleans or arbitrary file lists accepted. */
export function collectSupervisorInput(o: SupervisorInputOptions): { snapshot: Snapshot; facts: Facts; basis: string; directory: string } {
  const c = o.context, root = c.projectRoot, state = c.sharedState;
  const expectedOwnHold = o.expectedOwnHold ? structuredClone(o.expectedOwnHold) : undefined;
  const tracker = c.config.TRACKER;
  const project: ProjectIdentity = { root, tracker: { kind: tracker.kind, host: tracker.gitlabHost ?? tracker.host!, project: tracker.project } };
  if (!Number.isSafeInteger(o.ticket) || o.ticket <= 0) return hold('one explicit positive ticket is required');
  if (c.config.workflow.mode !== 'factory') return hold('complete project workflow override collection is unsupported; no fallback');
  if (supervisorHash(o.tracker.identity) !== supervisorHash(project.tracker)) return hold('tracker identity differs from selected project');
  requireProjectLayout(root); c.assertCurrent({strictOriginals:true});
  for (const mount of [root,c.runtimeRoot]) if (inside(mount,state) || inside(mount,o.output)) return hold('private originals/state overlap project or selected runtime mounts');
  for (const dir of [state,o.output]) {
    const st = lstatSync(dir);
    if (!st.isDirectory() || realpathSync(dir) !== dir || st.mode & 0o077 || st.uid !== process.getuid?.()) return hold(`host directory is not private/canonical: ${dir}`);
  }
  const reads = new Map<string,string>();
  const read = (file: string, max = MAX) => { const text = readSupervisorOriginal(file,max); reads.set(file,text); return text; };
  const registryRaw = read(o.registry), registry = JSON.parse(registryRaw);
  if (registry.version !== 1 || !Array.isArray(registry.projects) || registry.projects.filter((p: any) => p.root === root).length !== 1) return hold('selected checkout is not uniquely registered');
  const runFile = join(state,`${keyFor(String(o.ticket),tracker.project)}.json`), runRaw = read(runFile), run = JSON.parse(runRaw);
  const segment = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
  if (run.project !== tracker.project || run.iid !== String(o.ticket) || !segment(run.executionId) || !run.branch || !run.base || !/^[a-f0-9]{40,64}$/.test(run.implementationBaseSha ?? '')) return hold('missing saved run or legacy execution/baseline identity');
  if (!['stopped','waiting','done'].includes(run.stage) || run.starting) return hold('saved run is not parked/terminal; collection grants no quiescence authority');
  const attemptId = run.recovery ? run.recovery.id : null;
  if (run.recovery && !segment(attemptId) || (run.ticketInput?.attemptId ?? null) !== attemptId) return hold('missing/mismatched exact saved attempt identity');
  let attemptRaw: string | null = null, attempt: AttemptRecord | null = null;
  if (attemptId) {
    attemptRaw = read(join(state,'recovery','attempts',`${attemptId}.json`));
    const decoded = decodeAttemptRecord(JSON.parse(attemptRaw));
    if (!decoded.ok) return hold(decoded.reason);
    const a = decoded.record; attempt = a;
    if (a.id !== attemptId || a.seq !== run.recovery.attempt || a.executionId !== run.executionId || a.iid !== run.iid || a.project !== tracker.project || a.branch !== run.branch || a.base !== run.base || a.implementationBaseSha !== run.implementationBaseSha || a.phase !== 'finished'
      || a.worktree !== canonicalWorktree(root,run.branch) || a.gitDir !== attemptGitDir(root,a.id)
      || a.evidence !== attemptEvidence(root,run.iid,a.id) || a.previousEvidence !== run.evidenceDir) return hold('saved attempt identity/cleanup/evidence relationship is incomplete');
  }
  const receiptRaw = read(receiptFile(state,projectId(root,project.tracker),run.iid)), receipt = JSON.parse(receiptRaw);
  const worktree = canonicalWorktree(root,run.branch);
  if (receipt.version !== 1 || receipt.projectRoot !== root || receipt.projectId !== projectId(root,project.tracker) || receipt.ticket !== run.iid || receipt.branch !== run.branch || receipt.base !== run.base || receipt.implementationBaseSha !== run.implementationBaseSha || receipt.worktreePath !== worktree || receipt.runId !== (attemptId ?? run.executionId)) return hold('saved ownership receipt is missing/stale');
  const admissionPath = join(state,'admission','state.json');
  const ownership = () => {
    const raw = readSupervisorOriginal(admissionPath), parsed = JSON.parse(raw);
    if (parsed.version !== 2) return hold('legacy admission cannot establish definitive managed ownership');
    return supervisorInputOwnership(migrateAdmission(parsed),project,expectedOwnHold);
  };
  const owner = ownership();
  const git = (...args: string[]) => supervisorInputGit(root,args);
  if (git('rev-parse','--show-toplevel') !== root || git('rev-parse','--path-format=absolute','--git-common-dir') !== receipt.gitCommonDir) return hold('Git ownership/common directory changed');
  const tip = git('rev-parse','--verify',`${run.branch}^{commit}`), baseSha = git('rev-parse','--verify',`${run.base}^{commit}`);
  git('cat-file','-e',`${run.implementationBaseSha}^{commit}`);
  const savedInputRoot = join(state,'ticket-inputs',keyFor(run.iid,tracker.project),run.executionId,...(attemptId ? [attemptId] : []));
  const savedContextRaw = read(join(savedInputRoot,'ticket-context.json')), savedContext = JSON.parse(savedContextRaw);
  const savedText = read(join(savedInputRoot,'ticket-context.txt'));
  if (!run.ticketInput || ticketContextHash(savedContext) !== run.ticketInput.hash || savedContext.contentHash !== run.ticketInput.hash || sourceHash(savedText) !== run.ticketInput.renderedSha256) return hold('saved execution ticket-input originals are missing/stale');
  const collected = collectSupervisorTicketInput(o.tracker,o.ticket);
  const sources: Source[] = [...collected.sources];
  // Only explicit configured Markdown originals. No auth, .env, home settings or arbitrary discovery.
  const instructionPaths = [...new Set(Object.values(c.config.instructions).flat())].sort();
  for (const path of instructionPaths) {
    const file = resolve(root,path);
    if (!inside(root,file) || !/\.md$/i.test(file) || file.split('/').some(p => /^(?:\.env(?:\..*)?|auth\.json)$/i.test(p))) return hold('unsafe explicit instruction path');
    sources.push(original('guidelines',file,read(file)));
  }
  if (!instructionPaths.length) sources.push(original('guidelines','project:no-additive-instructions','','not-applicable'));
  const configRaw = read(join(root,'.factory','factory.toml'));
  sources.push(original('factory-rules',c.codePath('prompt.supervisor.md'),read(c.codePath('prompt.supervisor.md'))));
  sources.push(original('factory-rules',c.codePath('model-policy.mts'),read(c.codePath('model-policy.mts'))));
  sources.push(original('gate',c.codePath('prompt.verify.md'),read(c.codePath('prompt.verify.md'))));
  sources.push(original('gate',join(root,'.factory','factory.toml'),configRaw));
  sources.push(original('failure',runFile,runRaw));
  if (attemptRaw) sources.push(original('failure',`saved-attempt:${attemptId}`,attemptRaw));
  // Exact named evidence, never a status excerpt. An interrupted pre-verifier run may legitimately have no report.
  const evidence = attempt ? attempt.evidence : run.evidenceDir;
  if (!evidence || resolve(evidence) !== evidence || !inside(join(root,'.factory','evidence'),evidence)
    || !run.evidenceDir || resolve(run.evidenceDir) !== run.evidenceDir || !inside(join(root,'.factory','evidence'),run.evidenceDir)) return hold('saved evidence location missing/unsupported');
  // A finished recovery's current originals are authoritative; older implementation evidence is never substituted.
  let failures = 0; const absent: string[] = [];
  for (const name of ['verification.json','verdict.md','blocked.json']) {
    const file = join(evidence,name);
    try { const text = read(file); sources.push(original('failure',file,text)); failures++; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; absent.push(file); }
  }
  if (!failures) return hold('no complete saved failure/gate outcome original; stopped summary is not evidence');
  const reportSource = sources.find(s => s.locator === join(evidence,'verification.json'));
  if (reportSource) {
    const report = validateReport(JSON.parse(reportSource.text));
    for (const artifact of report.artifacts) {
      const file = resolve(evidence,artifact.path);
      if (!inside(evidence,file) || artifact.path.startsWith('/') || artifact.path.split('/').some(p => /^(?:\.env(?:\..*)?|auth\.json|credentials.*)$/i.test(p))) return hold('unsafe failure artifact reference');
      if (artifact.kind !== 'command-output') return hold(`relevant ${artifact.kind} original requires a complete binary-input contract: ${file}`);
      sources.push(original('failure',file,read(file)));
    }
  }
  const journalPath = join(state,'supervisor','state.json');
  const decisions = () => {
    let raw: string | null;
    try { raw = readSupervisorOriginal(journalPath,8*1024*1024); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; raw = null; }
    const originals = supervisorDecisionSources(raw,project,o.ticket,o.observedAt);
    for (const s of [...originals]) if (s.locator.startsWith('supervisor:review-provenance:')) {
      const id = s.locator.slice('supervisor:review-provenance:'.length), completion = JSON.parse(s.text);
      const review = JSON.parse(originals.find(s => s.locator === `supervisor:review:${id}`)!.text);
      const expected = join(state,'supervisor',supervisorHash(root),supervisorHash(review.invocationId),'input.json');
      if (completion.inputRef !== expected) return hold('relevant review original reference escaped its host-owned location');
      const text = read(expected), frozen = JSON.parse(text), input = validateReviewInput(frozen.input);
      if (supervisorHash(input) !== review.inputHash || input.proposal.id !== review.proposalId) return hold('relevant independent review originals are stale');
      originals.push(original('prior-decisions',expected,text));
    }
    return originals.sort((a,b) => a.locator.localeCompare(b.locator) || a.sha256.localeCompare(b.sha256));
  };
  sources.push(...decisions());
  // Material originals are frozen separately, not misrepresented as instructions or authoritative prior decisions.
  const settings = JSON.parse(JSON.stringify(normalizedSettings(c.config)));
  const runtimeManifest = read(c.codePath('runtime-manifest.json'));
  const bindings = { run:runRaw, attempt:attemptRaw, receipt:receiptRaw, config:configRaw, savedContext:savedContextRaw, savedText, settings, ownership:owner, baseSha, tip, attemptId, runtimeManifest };
  const material = { runId:run.executionId, base:run.base, baseline:run.implementationBaseSha, tip,
    runtime:c.manifest.id, dependencies:c.manifest.dependencies,
    settings:supervisorHash(settings), policy:supervisorHash({MODEL_POLICY_ID,MODEL_POLICY,AGENT_POLICY,bindings}),
    ticketInput:collected.input.hash, admissionGeneration:supervisorHash(owner) };
  const snapshot = supervisorReviewSnapshot({ project,scope:{kind:'ticket',ticket:o.ticket},observedAt:o.observedAt,material,sources,
    projectGuidelines:sources.filter(s => s.role === 'guidelines').map(s => s.locator),factoryConstraints:sources.filter(s => s.role === 'factory-rules').map(s => s.locator) });
  const facts: Facts = { scope:snapshot.scope,runId:run.executionId,requirements:collected.input.hash,
    gate:supervisorHash(sources.filter(s => s.role === 'gate')),failure:supervisorHash(sources.filter(s => s.role === 'failure')) };
  c.assertCurrent({strictOriginals:true});
  for (const path of absent) { try { lstatSync(path); return hold(`new failure original appeared: ${path}`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  for (const [path,text] of reads) if (readSupervisorOriginal(path) !== text) return hold(`material changed during collection: ${path}`);
  if (git('rev-parse','--verify',`${run.branch}^{commit}`) !== tip || git('rev-parse','--verify',`${run.base}^{commit}`) !== baseSha || supervisorHash(ownership()) !== supervisorHash(owner)
    || supervisorHash(decisions()) !== supervisorHash(sources.filter(s => s.role === 'prior-decisions'))) return hold('material/ownership/authoritative decision set changed during collection');
  const basis = diagnosisBasis(snapshot), directory = join(o.output,`${basis}-${supervisorHash(o.observedAt)}`);
  mkdirSync(directory,{mode:0o700});
  const destination = lstatSync(directory);
  if (realpathSync(directory) !== directory || !destination.isDirectory() || destination.mode & 0o077) return hold('private freeze destination changed');
  writeFileSync(join(directory,'originals.json'),JSON.stringify({version:1,snapshot,facts,bindings,ticketInput:collected.input,basis})+'\n',{flag:'wx',mode:0o600});
  return {snapshot,facts,basis,directory};
}
/** Compatibility name for explicit host composition; not a scheduler or send entrypoint. */
export const completeSnapshot = collectSupervisorInput;
