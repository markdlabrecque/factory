// Versioned local readiness observations and attributed attention text. These facts never authorize a launch.
import { createHash } from 'node:crypto';
export type ReadinessStatus = 'ready' | 'blocked' | 'unknown';
export type ReadinessScope = 'project' | 'ticket-input' | 'ticket-workspace' | 'sandbox';
export type ReadinessPhase = 'passive' | 'active' | 'sandbox';
export interface ReadinessIdentity {
  projectRoot: string;
  runtimeIdentity: string;
  configIdentity: string;
  contextFingerprint: string;
}
export interface ObservationOwner { invocationId: string; ownerId: string; generation: string }
export interface ReadinessCheck {
  id: string;
  scope: ReadinessScope;
  phase: ReadinessPhase;
  observedAt: string;
  status: ReadinessStatus;
  required: boolean;
  operation: string;
  path: string;
  errno?: string;
  reason: string;
  nextActor: 'operator' | 'factory' | 'none';
  nextAction: string;
  automaticRecheck: 'next-launch' | 'none';
  capacity?: { bytesAvailable: string | null; inodesAvailable: string | null };
}
export interface ReadinessReport {
  version: 1;
  identity: ReadinessIdentity;
  owner: ObservationOwner;
  observedAt: string;
  phase: ReadinessPhase;
  status: ReadinessStatus;
  checks: ReadinessCheck[];
}
/** Display-only attention projection, shared by readiness and execution diagnostics. */
export function attentionText(value: {
  observed: string; agentReported?: string; nextActor: ReadinessCheck['nextActor'];
  nextAction: string; automaticAction: string; evidence: string;
}): string {
  return `Factory observed: ${value.observed}. Agent reported: ${value.agentReported ? JSON.stringify(value.agentReported) : 'unavailable; cause unknown'}. ` +
    `Next actor: ${value.nextActor}. ${value.nextAction} Automatic action: ${value.automaticAction} Evidence: ${value.evidence}.`;
}
export const MAX_REPORT_BYTES = 256 * 1024;
export const DISPLAY_FRESHNESS_MS = 60_000;
export const identityKey = (identity: ReadinessIdentity): string => createHash('sha256').update(JSON.stringify([
  identity.projectRoot, identity.runtimeIdentity, identity.configIdentity, identity.contextFingerprint,
])).digest('hex');
export const projectKey = (root: string): string => createHash('sha256').update(root).digest('hex');
export function reportStatus(checks: ReadinessCheck[]): ReadinessStatus {
  return checks.some(c => c.required && c.status === 'blocked') ? 'blocked'
    : checks.some(c => c.required && c.status === 'unknown') || !checks.length ? 'unknown' : 'ready';
}
const keys = (v: any, allowed: string[]) => v && typeof v === 'object' && Object.keys(v).every(k => allowed.includes(k));
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v);
const nonempty = (v: unknown): v is string => text(v) && v.length > 0;
const date = (v: unknown) => nonempty(v) && Number.isFinite(Date.parse(v));
const one = (v: unknown, values: string[]) => values.includes(v as string);
const capacity = (v: any) => v === undefined || (keys(v, ['bytesAvailable', 'inodesAvailable']) && ['bytesAvailable', 'inodesAvailable'].every(k => v[k] === null || (typeof v[k] === 'string' && /^\d{1,40}$/.test(v[k]))));
export function validIdentity(v: any): v is ReadinessIdentity {
  return keys(v, ['projectRoot', 'runtimeIdentity', 'configIdentity', 'contextFingerprint']) && nonempty(v.projectRoot) && v.projectRoot.startsWith('/') &&
    ['runtimeIdentity', 'configIdentity', 'contextFingerprint'].every(k => nonempty(v[k]));
}
export function validReport(v: any): v is ReadinessReport {
  return !!(keys(v, ['version', 'identity', 'owner', 'observedAt', 'phase', 'status', 'checks']) && v.version === 1 && validIdentity(v.identity) && keys(v.owner, ['invocationId', 'ownerId', 'generation']) &&
    ['invocationId', 'ownerId', 'generation'].every(k => nonempty(v.owner[k])) && date(v.observedAt) &&
    one(v.phase, ['passive', 'active', 'sandbox']) && Array.isArray(v.checks) && v.checks.length <= 256 &&
    v.checks.every((c: any) => keys(c, ['id', 'scope', 'phase', 'observedAt', 'status', 'required', 'operation', 'path', 'errno', 'reason', 'nextActor', 'nextAction', 'automaticRecheck', 'capacity']) && nonempty(c.id) && one(c.scope, ['project', 'ticket-input', 'ticket-workspace', 'sandbox']) &&
      c.phase === v.phase && date(c.observedAt) && one(c.status, ['ready', 'blocked', 'unknown']) && typeof c.required === 'boolean' &&
      nonempty(c.operation) && text(c.path) && text(c.reason) && text(c.nextAction) &&
      one(c.nextActor, ['operator', 'factory', 'none']) && one(c.automaticRecheck, ['next-launch', 'none']) &&
      (c.errno === undefined || /^[A-Z][A-Z0-9_]{0,39}$/.test(c.errno)) &&
      capacity(c.capacity)) &&
    v.status === reportStatus(v.checks));
}
/** Display-only policy, including future timestamps. Never use this as launch authority. */
export function displayFreshness(report: ReadinessReport, identity: ReadinessIdentity, now = Date.now(), maxAgeMs = DISPLAY_FRESHNESS_MS): 'current' | 'stale' {
  const age = now - Date.parse(report.observedAt);
  return identityKey(report.identity) === identityKey(identity) && age >= 0 && age <= maxAgeMs ? 'current' : 'stale';
}
export function safeErrno(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(code) ? code : 'EUNKNOWN';
}
