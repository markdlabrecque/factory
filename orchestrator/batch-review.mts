// Host-only prospective gate: one immutable Git candidate per attempt, independent role receipts and durable per-batch/ticket rejection accounting.
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { frozenTicketIdentity, type FrozenTicketInput } from './ticket-input.mts';
import { candidatePack, prospectiveCommit, reviewMaterial } from './batch-candidate.mts';
import { standardBatchSandbox, type BatchSandbox, type ProcessResult, type ReviewRole } from './batch-sandbox.mts';
import type { EffectiveConfig } from './project-config.mts';
import { modelForRole } from './model-policy.mts';

export interface BatchAttemptInput {
  repo: string; state: string; batch: string; destination: string; expectedHead: string; run: string;
  ticket: FrozenTicketInput; deltaBase: string; deltaTip: string; testArgv: string[]; testPaths: string[];
  // Host reads current ref AND the batch ownership ledger, not worker-reported Git state.
  observeHead(): Promise<{kind:'owned'|'unknown'; head:string}>;
}
/** Standard host composition; overrides must opt into their own contract, never inherit this gate. */
export function runStandardBatchAttempt(input: Omit<BatchAttemptInput,'testArgv'|'testPaths'>, config: EffectiveConfig, pinnedImage: string, reviewerCredential: () => string) {
  if (config.workflow.mode !== 'factory' || !config.config.batchTests) throw Error('Standard batch test configuration required');
  const id = input.ticket.context.identity, tracker = config.TRACKER;
  if (id.kind !== tracker.kind || id.host !== (tracker.gitlabHost ?? tracker.host) || id.project !== tracker.project) throw Error('Ticket does not belong to the pinned project');
  return runBatchAttempt({...input,testArgv:config.config.batchTests.argv,testPaths:config.config.batchTests.paths},
    standardBatchSandbox(pinnedImage,modelForRole(config.AGENT.family,'verification').model,reviewerCredential));
}
export interface AttemptBinding {
  project: string; batch: string; ticket: number; run: string; attempt: string; destination: string; expectedHead: string;
  requirementsDigest: string; candidate: string; deltaBase: string; deltaTip: string;
}
export type ReviewReceipt = {binding: AttemptBinding; role: ReviewRole; invocation: string; verdict: 'approve'|'reject'|'inconclusive'; reason: string};
export interface BatchEvidence {
  version: 'batch-review-v1'; binding: AttemptBinding;
  tests: {binding: AttemptBinding; argv: string[]; exit: number|null; stdout: string; stderr: string};
  reviews: ReviewReceipt[]; status: 'implementation'|'held'|'approved'|'rework'|'rebuild'|'stopped'; reason: string;
}
function openStore(root: string, readOnly = false) {
  if (!readOnly) mkdirSync(root,{recursive:true,mode:0o700});
  if (realpathSync(root) !== resolve(root) || (lstatSync(root).mode & 0o077)) throw Error('Private host gate directory required');
  const path = join(root,'batch-review.sqlite');
  try { const st = lstatSync(path); if (!st.isFile() || st.nlink !== 1) throw Error('Unsafe gate store'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  const db = new DatabaseSync(path,{readOnly});
  if (readOnly) return db;
  chmodSync(path,0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, scope TEXT NOT NULL, binding TEXT NOT NULL, rejected INTEGER NOT NULL DEFAULT 0, result TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS occupied ON attempts(scope) WHERE result IS NULL;`);
  return db;
}
/** Read the host record, not a payload-provided receipt. A pending/crashed attempt has no evidence. */
export function readBatchEvidence(state: string, attempt: string): BatchEvidence | null {
  const db = openStore(state,true);
  try { const row = db.prepare('SELECT result FROM attempts WHERE id=?').get(attempt); return row?.result ? JSON.parse(String(row.result)) : null; }
  finally { db.close(); }
}
/** Resume discovery. A running/uncertain attempt is a hold, not another allowance or a delivery proof. */
export function latestBatchAttempt(state: string, project: string, batch: string, ticket: number): {binding:AttemptBinding; evidence:BatchEvidence|null} | null {
  const db = openStore(state,true);
  try {
    const row = db.prepare('SELECT binding,result FROM attempts WHERE scope=? ORDER BY rowid DESC LIMIT 1').get(JSON.stringify([project,batch,ticket]));
    return row ? {binding:JSON.parse(String(row.binding)),evidence:row.result ? JSON.parse(String(row.result)) : null} : null;
  } finally { db.close(); }
}
export function classifyBatchReview(testsPassed: boolean, reviews: Pick<ReviewReceipt,'role'|'verdict'|'invocation'>[], previousRejections: number): Pick<BatchEvidence,'status'|'reason'> {
  if (!testsPassed) return {status:'implementation',reason:'Candidate tests did not pass'};
  if (reviews.some(r => r.verdict === 'reject')) return previousRejections >= 2
    ? {status:'stopped',reason:'Both review reworks exhausted'} : {status:'rework',reason:'Reviewer rejected this candidate'};
  if (reviews.length !== 2 || !(['test','code'] as const).every(role => reviews.some(r => r.role === role && r.verdict === 'approve')) || reviews[0].invocation === reviews[1].invocation)
    return {status:'held',reason:'Two independent explicit approvals unavailable'};
  return {status:'approved',reason:'Tests and both reviews passed; not delivered'};
}
function verdict(result: ProcessResult): Pick<ReviewReceipt,'verdict'|'reason'> {
  if (result.exit === 0 && Buffer.byteLength(result.stdout) <= 16384) try {
    const r = JSON.parse(result.stdout);
    if (Object.keys(r).sort().join(',') === 'reason,verdict' && ['approve','reject','inconclusive'].includes(r.verdict) && typeof r.reason === 'string' && r.reason.trim() && r.reason.length <= 2000) return r;
  } catch { /* Missing or malformed verdict is not approval. */ }
  return {verdict:'inconclusive', reason:'Reviewer returned no usable verdict'};
}
export function batchImplementationPrompt(ticket: FrozenTicketInput) {
  frozenTicketIdentity(ticket);
  return template('implementation') + '\n' + ticket.text;
}
function template(role: 'implementation'|ReviewRole) { return readFileSync(new URL(`./prompt.batch-${role}.md`,import.meta.url),'utf8'); }
export async function runBatchAttempt(input: BatchAttemptInput, sandbox: BatchSandbox): Promise<BatchEvidence> {
  const {repo,state,batch,destination,expectedHead,run,deltaBase,deltaTip} = input;
  const {contentHash: requirementsDigest} = frozenTicketIdentity(input.ticket);
  const {identity,child} = input.ticket.context, project = `${identity.kind}://${identity.host}/${identity.project}`, ticket = child.iid;
  const requirements = input.ticket.text, testArgv = [...input.testArgv], testPaths = [...input.testPaths];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(batch) || destination !== `refs/heads/factory/batch/${batch}` || !run?.trim()) throw Error('Invalid batch/run destination identity');
  if (![testArgv,testPaths].every(a => a.length && a.every(s => typeof s === 'string' && s.trim() && !s.includes('\0'))) || testPaths.some(p => p.startsWith(':') || p.startsWith('/') || p.split('/').some(x => !x || x === '..' || x === '.'))) throw Error('Configured test argv and repository-relative test files/directories required');
  const attempt = randomUUID(), scope = JSON.stringify([project,batch,ticket]);
  if (resolve(state) === realpathSync(repo) || resolve(state).startsWith(realpathSync(repo) + '/')) throw Error('Gate store must be outside the project');
  const initial = await input.observeHead();
  if (initial.kind !== 'owned' || initial.head !== expectedHead) throw Error('Expected owned batch head not current');
  const db = openStore(state);
  // Git may be slow. Check before construction, then reserve atomically; never hold the database writer during Git/process I/O.
  function available() {
    const rejected = Number(db.prepare('SELECT count(*) AS n FROM attempts WHERE scope=? AND rejected=1').get(scope)!.n);
    if (rejected >= 3) throw Error('Both review reworks exhausted');
    const prior = db.prepare('SELECT result FROM attempts WHERE scope=? AND rejected=1 ORDER BY rowid DESC LIMIT 1').get(scope);
    if (prior) {
      const last = (JSON.parse(String(prior.result)) as BatchEvidence).binding;
      if (last.deltaTip === deltaTip && last.expectedHead === expectedHead && last.requirementsDigest === requirementsDigest) throw Error('Rejected delta requires rework');
    }
    if (db.prepare('SELECT id FROM attempts WHERE scope=? AND result IS NULL').get(scope)) throw Error('Prior batch attempt unresolved; hold for reconciliation');
    return rejected;
  }
  try {
    available();
    const candidate = prospectiveCommit(repo,expectedHead,deltaBase,deltaTip,attempt);
    db.exec('BEGIN IMMEDIATE');
    const rejected = available();
    const binding = {project,batch,ticket,run,attempt,destination,expectedHead,requirementsDigest,candidate,deltaBase,deltaTip};
    db.prepare('INSERT INTO attempts(id,scope,binding) VALUES(?,?,?)').run(attempt,scope,JSON.stringify(binding)); db.exec('COMMIT');
    const observe = async (fn: () => Promise<ProcessResult>) => {
      try { return await fn(); } catch { return {exit:null,stdout:'',stderr:'Host could not observe process completion'}; }
    };
    const observed = await observe(() => sandbox.test(candidate,candidatePack(repo,candidate),[...testArgv]));
    const tests = {binding,argv:testArgv,exit:observed.exit,stdout:observed.stdout.slice(-32768),stderr:observed.stderr.slice(-32768)};
    let reviews: ReviewReceipt[] = [];
    const passed = tests.exit === 0;
    if (passed) {
      try {
        const {tests: sources,diff} = reviewMaterial(repo,expectedHead,candidate,testPaths);
        if (!sources.length) throw Error('No candidate tests to review');
        const prompts = {test: template('test')+'\n'+JSON.stringify({requirements,tests:sources}),
          code: template('code')+'\n'+JSON.stringify({diff,requirements})};
        reviews = await Promise.all((['test','code'] as const).map(async role => {
          const invocation = randomUUID();
          return {binding,role,invocation,...verdict(await observe(() => sandbox.review(role,invocation,prompts[role])))};
        }));
      } catch { /* Material unavailable: incomplete evidence holds. */ }
    }
    const final = await input.observeHead().catch(() => ({kind:'unknown',head:''}));
    const outcome: Pick<BatchEvidence,'status'|'reason'> = final.kind !== 'owned' ? {status:'held',reason:'Batch ownership or movement unknown'}
      : final.head !== expectedHead ? {status:'rebuild',reason:'Host advanced batch; construct and recheck on current head'}
      : classifyBatchReview(passed,reviews,rejected);
    const result: BatchEvidence = {version:'batch-review-v1',binding,tests,reviews,...outcome};
    db.prepare('UPDATE attempts SET rejected=?,result=? WHERE id=? AND result IS NULL').run(Number(['rework','stopped'].includes(outcome.status)),JSON.stringify(result),attempt);
    return result;
  } finally { db.close(); }
}
