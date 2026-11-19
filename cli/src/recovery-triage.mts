// Run the selected triage helper within a bounded, owned group. Only confirmed cleanup permits fallback to preparation.
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { claimManagedEntry, releaseManagedEntry } from '../../board/admission.mts';
import { digest } from '../../orchestrator/recovery-analysis-contract.mts';
import { parseTriageResult, TRIAGE_STDOUT_LIMIT, unavailable } from '../../orchestrator/recovery-triage-contract.mts';
import type { TriageResult } from '../../orchestrator/recovery-triage-contract.mts';
import type { Paths } from './paths.mts';
import { runRecoveryHelper } from './recovery-helper-process.mts';
import type { RecoveryHelperOptions } from './recovery-helper-process.mts';
import type { projectWorkflow } from './workflow.mts';

export type TriageOptions = RecoveryHelperOptions & { ticket: number; base: string; workflow: ReturnType<typeof projectWorkflow> };
export type TriageOutcome = TriageResult | { state: 'ownership'; reason: string };

const ownerFile = (p: Paths, root: string) => join(p.recovery, `triage-${digest(resolve(root))}.json`);
export function triageOwnershipProblem(p: Paths, root: string): string | undefined {
  const owner = ownerFile(p, root);
  try { lstatSync(owner); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    return `Cannot confirm recovery triage ownership at ${owner}`;
  }
  return `Previous triage ownership is unconfirmed: ${owner}; confirm the recorded process group is gone before clearing this hold`;
}

export async function triageRecovery(p: Paths, o: TriageOptions): Promise<TriageOutcome> {
  const prior = triageOwnershipProblem(p, o.root);
  if (prior) return { state: 'ownership', reason: prior };
  if (o.signal?.aborted) return unavailable('Recovery triage cancelled');
  const { workflow } = o;
  const timeout = workflow.config.GRAPH.analysisTimeoutMinutes * 60_000 + 60_000;
  if (!Number.isFinite(timeout) || timeout <= 60_000 || timeout > 2_147_483_647) return unavailable('Invalid recovery triage deadline');
  const tracker = workflow.config.TRACKER;
  let entry: string;
  try { entry = claimManagedEntry(o.dir, { root: o.root, tracker: { kind: tracker.kind, host: tracker.gitlabHost ?? tracker.host!, project: tracker.project } }); }
  catch { return { state: 'ownership', reason: 'Could not claim managed entry for recovery triage' }; }
  const owner = ownerFile(p, o.root);
  const record = (pid?: number) => JSON.stringify({ root: o.root, entry, pid, at: new Date().toISOString() });
  let created = false, uncertain = false;
  try {
    try {
      mkdirSync(p.recovery, { recursive: true });
      writeFileSync(owner, record(), { flag: 'wx', mode: 0o600 });
      created = true;
    } catch { return { state: 'ownership', reason: `Cannot establish recovery triage ownership at ${owner}` }; }
    const result = await runRecoveryHelper(o, { args: [workflow.entrypoints.triage, String(o.ticket), o.base],
      env: workflow.env, name: 'Triage', owner, timeout, byteLimit: TRIAGE_STDOUT_LIMIT,
      recordPid: pid => writeFileSync(owner, record(pid)) });
    if (result.code === 'ownership') {
      uncertain = true;
      return { state: 'ownership', reason: result.reason! };
    }
    if (!result.ok || o.signal?.aborted) {
      // Never surface raw stderr from a helper which handles private ticket evidence.
      return unavailable(o.signal?.aborted ? 'Recovery triage cancelled' : result.code === 'timeout' ? 'Recovery triage timed out'
        : result.overflow ? 'Recovery triage output exceeded 16 KiB' : 'Recovery triage helper failed');
    }
    try { return parseTriageResult(result.output); }
    catch { return unavailable('Invalid recovery triage helper result'); }
  } finally {
    if (!uncertain) {
      if (created) rmSync(owner, { force: true });
      releaseManagedEntry(o.dir, entry);
    }
  }
}
