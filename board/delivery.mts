// #153: strict host checkpoint identity; legacy notes and PR URLs alone never authorize continuation.
export type DeliveryReason = 'opened' | 'checks-pending' | 'checks-missing' | 'checks-failed' | 'identity-changed' | 'closed' | 'draft' | 'merge-restricted' | 'authorization' | 'transport-unknown' | 'merged';
export interface DeliveryIdentity {
  kind: 'github' | 'gitlab'; host: string; repository: string; projectId?: number;
  number: number; url: string; branch: string; base: string; sha: string;
}
export interface DeliveryCheckpoint extends DeliveryIdentity {
  version: 1; proofId: string; project: string; ticket: string; executionId: string;
  state: 'ci-waiting' | 'operator-required' | 'merged'; reasonCode: DeliveryReason;
  observedAt: string; mergedAt?: string;
}
export function validDelivery(x: any): x is DeliveryCheckpoint {
  const allowed = ['version','proofId','project','ticket','executionId','kind','host','repository','projectId','number','url','branch','base','sha','state','reasonCode','observedAt','mergedAt'];
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => !allowed.includes(k)) || x.version !== 1 || !['github', 'gitlab'].includes(x.kind)
    || !['ci-waiting', 'operator-required', 'merged'].includes(x.state)
    || !['opened', 'checks-pending', 'checks-missing', 'checks-failed', 'identity-changed', 'closed', 'draft', 'merge-restricted', 'authorization', 'transport-unknown', 'merged'].includes(x.reasonCode)) return false;
  if (!['host', 'repository', 'project', 'ticket', 'executionId', 'branch', 'base'].every(k => typeof x[k] === 'string' && x[k].trim().length > 0)
    || !Number.isSafeInteger(x.number) || x.number < 1 || !/^[0-9a-f]{40,64}$/.test(x.sha)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x.proofId)
    || !Number.isFinite(Date.parse(x.observedAt)) || (x.mergedAt !== undefined && !Number.isFinite(Date.parse(x.mergedAt)))) return false;
  if (x.state === 'merged' ? x.reasonCode !== 'merged' : x.mergedAt !== undefined || x.reasonCode === 'merged') return false;
  if (x.state === 'ci-waiting' && !['opened','checks-pending','checks-missing','transport-unknown'].includes(x.reasonCode)) return false;
  if (x.kind === 'gitlab' && (!Number.isSafeInteger(x.projectId) || x.projectId < 1)) return false;
  try {
    const url = new URL(x.url);
    return url.protocol === 'https:' && url.host === x.host && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === `/${x.repository}/${x.kind === 'github' ? 'pull' : '-/merge_requests'}/${x.number}`
      && (x.state !== 'merged' || !!x.mergedAt);
  } catch { return false; }
}
export interface DeliveryObservation {
  state: 'ready' | 'ci-waiting' | 'operator-required' | 'merged';
  reasonCode: DeliveryReason; reason: string; mergedAt?: string;
}
