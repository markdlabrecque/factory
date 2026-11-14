// #153: import-safe single observation of a host-recorded PR; no agents, repair charge, comments or creation.
// All production subprocesses share one 30s deadline and a 10s per-command limit; locks cover only local CAS.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readProof, sha256 } from './verification.mts';
import { validDelivery } from './delivery.mts';
import type { DeliveryCheckpoint, DeliveryIdentity, DeliveryObservation } from './delivery.mts';
import type { RunState } from './board.mts';

/** A failed current tracker read is unknown, not a requirements edit or a permanent proof refusal. */
export class RetryableDeliveryRead extends Error { readonly code = 'DELIVERY_READ_UNKNOWN'; }
export function bounded(command: string, args: string[], deadline: number): string {
  const left = deadline - Date.now(); if (left <= 0) throw Error('Delivery observation deadline reached');
  return execFileSync(command, args, { encoding: 'utf8', timeout: Math.min(10000, left), killSignal: 'SIGKILL', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
/** Use only the tick-owned absolute entrypoint and saved Node; never resolve a command through PATH. */
export function schedulerAuthorization(root: string, base: string, deadline: number, env = process.env,
  run = bounded): string | undefined {
  if (env.FACTORY_SCHEDULED !== '1') return 'Not a scheduled pass';
  const cli = env.FACTORY_CLI_ENTRYPOINT, node = env.FACTORY_SCHEDULER_NODE;
  if (!cli || !node || !isAbsolute(cli) || !isAbsolute(node)) return 'Trusted scheduler CLI/Node missing; upgrade CLI and runtime together';
  try {
    const canonical = realpathSync(root);
    const status = JSON.parse(run(node, [cli, 'schedule', 'status', '--project', canonical, '--json'], deadline));
    if (status.version !== 1 || status.scheduler?.serviceEnabled !== true || status.scheduler?.timerActive !== true) return 'Scheduler disabled or unknown';
    if (!Array.isArray(status.projects) || status.projects.length !== 1) return 'Scheduler project identity unknown';
    const p = status.projects[0];
    if (p.root !== canonical || p.schedule?.enabled !== true || p.schedule?.branch !== base || p.blocker !== null) return 'Project paused, blocked or base branch changed';
    return undefined;
  } catch (e) { return `Scheduler authorization unknown: ${(e as Error).message}`; }
}
export interface FollowupHost {
  claim(run: RunState): { ok: true; run: RunState } | { ok: false; reason: string };
  finish(run: RunState, token: string, checkpoint: DeliveryCheckpoint, note: string): boolean;
  /** Recheck current tracker requirements/eligibility, local/remote identity, claim and live schedule. */
  authorize(run: RunState, deadline: number): string | undefined;
  merge(identity: DeliveryIdentity, authorize: () => string | undefined, deadline: number): Promise<DeliveryObservation>;
  state: string;
  workflow: string;
  settings: Record<string, unknown>;
}
/** Missing/malformed proof/config is an operator hold. Only a tracker transport/read failure remains retryable. */
export async function observeWaitingDelivery(run: RunState, host: FollowupHost): Promise<string> {
  if (!validDelivery(run.delivery) || run.delivery.state !== 'ci-waiting') return 'Not a host-recorded CI wait';
  const deadline = Date.now() + 30000;
  const admitted = host.claim(run); if (!admitted.ok) return admitted.reason;
  const owned = admitted.run, d = owned.delivery!, token = owned.claim!;
  const authorize = (): string | undefined => {
    try {
      if (Date.now() >= deadline) return 'Delivery observation deadline reached';
      if (!validDelivery(d) || d.project !== owned.project || d.ticket !== owned.iid || d.executionId !== owned.executionId
        || d.branch !== owned.branch || d.base !== owned.base || owned.verification?.id !== d.proofId || owned.verification.tip !== d.sha || owned.verdict !== 'PASS') return 'Checkpoint/proof execution identity mismatch';
      const frozen = readProof(host.state, { project: d.project, ticket: d.ticket, executionId: d.executionId, attemptId: owned.recovery?.id,
        branch: d.branch, base: d.base, baseline: owned.implementationBaseSha ?? '', tip: d.sha, requirementsHash: owned.verification.requirementsHash }, d.proofId);
      if (frozen.report.verdict !== 'PASS') return 'Host proof is not PASS';
      const code = frozen.proof.provenance.code;
      const required = ['delivery-followup.mts', 'delivery.mts', 'board.mts', 'admission.mts', 'dispatch.mts', 'runtime-config.mts', 'project-config.mts', 'selection.mts', 'main.mts', 'handoff.mts', 'verification.mts', 'recovery.mts', 'recovery-sandbox.mts', 'tracker.mts', 'tracker.github.mts', 'tracker.gitlab.mts', 'ci.mts', 'prompt.verify.md'];
      if (!required.every(k => typeof code[k] === 'string')) return 'Workflow proof inputs missing; fresh verification required';
      for (const [path, hash] of Object.entries(code)) {
        if (!/^[a-zA-Z0-9.-]+$/.test(path) || sha256(readFileSync(resolve(host.workflow, path))) !== hash) return `Workflow changed: ${path}; fresh verification required`;
      }
      if (JSON.stringify(frozen.proof.provenance.settings) !== JSON.stringify(host.settings)) return 'Verification/merge settings changed; fresh verification required';
      return host.authorize(owned, deadline);
    } catch (e) {
      if ((e as any).code === 'DELIVERY_READ_UNKNOWN') throw e;
      return `Proof authorization failed: ${(e as Error).message}`;
    }
  };
  let result: DeliveryObservation;
  try {
    const refused = authorize();
    result = refused !== undefined ? { state: 'operator-required', reasonCode: 'authorization', reason: refused }
      : await host.merge(d, authorize, deadline);
  } catch (e) {
    result = { state: 'ci-waiting', reasonCode: 'transport-unknown', reason: `Tracker read/merge response unknown; observe same PR next pass: ${(e as Error).message}` };
  }
  if (result.state === 'ready') result = { state: 'operator-required', reasonCode: 'authorization', reason: 'Merge not confirmed' };
  const next: DeliveryCheckpoint = { ...d, state: result.state, reasonCode: result.reasonCode, observedAt: new Date().toISOString(), ...(result.mergedAt ? { mergedAt: result.mergedAt } : {}) };
  const note = `${next.state === 'merged' ? 'Merged' : next.state === 'ci-waiting' ? 'Pending CI' : 'Operator required'}: ${result.reason}`;
  return host.finish(owned, token, next, note) ? note : 'Delivery checkpoint changed; stale observer result discarded';
}
