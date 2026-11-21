// Pure exact-execution receipt reconciliation. A valid receipt is policy evidence, never delivery proof.
import { ACCEPTANCE_LIMITS, acceptanceHash, checkAcceptanceApproval, checkAcceptanceResults, type AcceptanceContract, type TrustedApprovalIngress } from './acceptance-contract.mts';

export interface AcceptanceExecutionBinding {
  executionId: string; bundleId: string; approvalId: string; approvalDigest: string; sha: string;
  runtime: string; dependencies: string; image: string; config: string; setup: string;
  reset: string; ownerId: string;
}
export interface AcceptanceReceipt {
  version: 1; binding: AcceptanceExecutionBinding; startedAt: number; deadline: number; finishedAt: number;
  cleanup: 'confirmed' | 'unknown'; results: unknown;
}
export function checkAcceptanceReceipt(contract: AcceptanceContract, approvals: TrustedApprovalIngress, receipt: unknown, expected: AcceptanceExecutionBinding, now: number, phase: 'baseline' | 'candidate' = 'baseline') {
  const hold = () => ({ status: 'hold' as const, code: 'invalid-receipt' as const, reason: 'Foreign, incomplete, late or unclean execution receipt' });
  if (!receipt || typeof receipt !== 'object') return hold();
  const r = receipt as AcceptanceReceipt;
  if (Object.keys(r).sort().join() !== 'binding,cleanup,deadline,finishedAt,results,startedAt,version'
    || r.version !== 1 || r.cleanup !== 'confirmed' || !r.binding
    || Object.keys(r.binding).sort().join() !== Object.keys(expected).sort().join()
    || Object.entries(expected).some(([k, v]) => typeof v !== 'string' || !v || r.binding[k as keyof AcceptanceExecutionBinding] !== v)
    || ![r.startedAt, r.deadline, r.finishedAt, now].every(Number.isSafeInteger)
    || r.startedAt < 0 || r.deadline <= r.startedAt || r.deadline - r.startedAt > ACCEPTANCE_LIMITS.timeoutMs
    || r.finishedAt < r.startedAt || r.finishedAt > r.deadline || now < r.finishedAt) return hold();
  const approved = checkAcceptanceApproval(contract, approvals);
  if (approved.status === 'hold') return approved;
  if (approved.value.approval.id !== expected.approvalId || acceptanceHash(approved.value.approval) !== expected.approvalDigest) return hold();
  // Freeze the single trusted observation; a second ingress read cannot substitute another review.
  return checkAcceptanceResults(approved.value.contract, { lookup: () => approved.value.approval }, r.results, phase);
}
