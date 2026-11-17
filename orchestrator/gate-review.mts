// Pure frozen original-context composition and strict exact-proposal review parsing; no invocation or action authority.
import { supervisorHash, validateReviewInput, validateIndependentReview } from './supervisor-contract.mts';
import type { ReviewInput, IndependentReview } from './supervisor-contract.mts';
export const REVIEW_OUTPUT_BYTES = 16384;
export type ReviewIdentity = { invocationId: string; reviewer: string; model: string; policy: string };
export function reviewContext(input: ReviewInput, identity: ReviewIdentity) {
  validateReviewInput(input);
  return { purpose: 'Independent project gate policy review, not verification or merge approval',
    identity, inputHash: supervisorHash(input), proposalId: input.proposal.id, input };
}
export function reviewContextHold(input: ReviewInput): string | undefined {
  validateReviewInput(input);
  const roles = ['child','parent','human-planning','guidelines','factory-rules','gate','failure','prior-decisions'];
  if (roles.some(role => !input.snapshot.sources.some(s => s.role === role)) || input.snapshot.sources.some(s => s.status !== 'complete'
    && !(s.status === 'not-applicable' && ['parent','human-planning','prior-decisions'].includes(s.role)))) return 'Original material context missing/truncated';
}
/** Entire stdout is one bounded JSON value. The host, not model output, assigns audit IDs and times. */
export function parseGateReview(stdout: string, input: ReviewInput, identity: ReviewIdentity, startedAt: string, completedAt: string): IndependentReview {
  validateReviewInput(input);
  if (Buffer.byteLength(stdout) > REVIEW_OUTPUT_BYTES) throw Error('Review output overflow');
  const x = JSON.parse(stdout);
  const fields = ['version','inputHash','proposalId','invocationId','reviewer','model','policy','disposition','reason'];
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).sort().join() !== fields.sort().join()) throw Error('Unknown/missing review fields');
  if (x.version !== 1 || x.inputHash !== supervisorHash(input) || x.proposalId !== input.proposal.id
    || Object.entries(identity).some(([k,v]) => x[k] !== v) || !['approve','deny'].includes(x.disposition)) throw Error('Review identity/policy/exact input mismatch');
  if (x.disposition === 'approve' && reviewContextHold(input)) throw Error('Incomplete original context cannot approve');
  const { policy: _policy, ...body } = x;
  return validateIndependentReview({ ...body, id: `review:${identity.invocationId}`, startedAt, completedAt });
}
