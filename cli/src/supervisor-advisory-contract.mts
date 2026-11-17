// Fixed advisory provider profile and strict immutable grants. Data validation never grants send or action authority.
import { existsSync } from 'node:fs';
import type { ProjectIdentity } from '../../orchestrator/supervisor-contract.mts';
import type { Owner } from '../../board/admission.mts';
const { supervisorHash, validateProject } = await import(existsSync(new URL('./supervisor-contract.mts', import.meta.url)) ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export const ADVISORY_PROFILE = Object.freeze({ version: 1, provider: 'openai', model: 'gpt-6.1-terra', api: 'openai-responses',
  endpoint: 'https://api.openai.com/v1/responses', thinking: 'high', piAi: '1.5.2', openai: '7.19.0',
  serializer: 'c35b80b2eb7f84b0ea1d939784943038956aefec7b624ed7862ebe2fd9d40c4b',
  catalogue: 'df2fe1f312051bbe29801ef903ab370c701a74a680f1370e96eb465eacd1d82d',
  price: 'terra-standard-2026-11-17-v1', service: 'default', cache: 'explicit-unmarked',
  input: 1_050_000, output: 4096, inputMicroNumerator: 550, outputMicroNumerator: 825, denominator: 100 });
export const ADVISORY_PROFILE_ID = supervisorHash(ADVISORY_PROFILE);
/** Explicit owner-approved subscription contract. Output is an admission target, NOT a remote ceiling. */
const { inputMicroNumerator: _inputPrice, outputMicroNumerator: _outputPrice, denominator: _denominator, ...subscriptionIdentity } = ADVISORY_PROFILE;
export const SUBSCRIPTION_PROFILE = Object.freeze({ ...subscriptionIdentity, version: 2, auth: 'pi-login',
  price: 'subscription-api-invoice-not-applicable', cache: 'provider-managed', outputPolicy: 'best-effort-local-target', remoteCap: false });
export const SUBSCRIPTION_PROFILE_ID = supervisorHash(SUBSCRIPTION_PROFILE);
export type AdvisoryAuth = 'api-key' | 'pi-login';
export function advisoryProfile(id: string) {
  advisoryDemand(id === ADVISORY_PROFILE_ID || id === SUBSCRIPTION_PROFILE_ID, 'unsupported advisory profile');
  return id === SUBSCRIPTION_PROFILE_ID ? SUBSCRIPTION_PROFILE : ADVISORY_PROFILE;
}
export const subscriptionProfile = (id: string) => id === SUBSCRIPTION_PROFILE_ID;
export function profileForAuth(auth: AdvisoryAuth = 'api-key') {
  advisoryDemand(auth === 'api-key' || auth === 'pi-login', 'explicit supported auth selection required');
  return auth === 'pi-login' ? SUBSCRIPTION_PROFILE_ID : ADVISORY_PROFILE_ID;
}
export const advisoryHash = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export const advisoryText = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 200 && !x.includes('\0');
export const advisoryCount = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
export const advisoryTime = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
export function advisoryDemand(x: unknown, why: string): asserts x { if (!x) throw Error(`Advisory held: ${why}`); }
export function advisoryRecord(x: any, fields: string[]) {
  advisoryDemand(x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x))
    && Object.keys(x).sort().join() === [...fields].sort().join(), 'unknown or missing fields');
}
export function validateAdvisoryOwner(x: any): Owner {
  advisoryRecord(x, ['pid','start']); advisoryDemand(Number.isSafeInteger(x.pid) && x.pid > 0 && advisoryText(x.start), 'exact PID/start owner required'); return x;
}
/** Upward rounded in integer micro-USD. The profile fixes service/cache/long-context/regional premises. */
export function advisoryReservation(profile = ADVISORY_PROFILE_ID) {
  const p = advisoryProfile(profile);
  if (subscriptionProfile(profile)) return { tokens: p.input + p.output, cost: 0 };
  const tokens = p.input + p.output;
  const numerator = BigInt(p.input) * BigInt(ADVISORY_PROFILE.inputMicroNumerator) + BigInt(p.output) * BigInt(ADVISORY_PROFILE.outputMicroNumerator);
  const cost = Number((numerator + BigInt(ADVISORY_PROFILE.denominator - 1)) / BigInt(ADVISORY_PROFILE.denominator));
  advisoryDemand(Number.isSafeInteger(tokens) && Number.isSafeInteger(cost), 'reservation overflow');
  return { tokens, cost };
}
/** Existing project USD ceilings are converted DOWN, never rounded up into extra permission. */
export function usdCeilingMicroUSD(value: number): number {
  advisoryDemand(typeof value === 'number' && Number.isFinite(value) && value > 0, 'finite positive USD ceiling required');
  const match = String(value).match(/^(\d+)(?:\.(\d+))?$/);
  advisoryDemand(match, 'USD ceiling must be a finite plain decimal');
  const fraction = (match[2] ?? '').padEnd(6, '0').slice(0, 6);
  const result = Number(BigInt(match[1]) * 1_000_000n + BigInt(fraction));
  advisoryDemand(Number.isSafeInteger(result) && result > 0, 'USD ceiling overflow or below one micro-USD'); return result;
}
export type DiagnosisGrant = { version: 1; id: string; project: ProjectIdentity; ticket: number; runId: string; attemptId: string | null;
  incidentId: string; basis: string; invocationId: string; fence: string; holdId: string; runtime: string; dependencies: string;
  profile: string; policy: string; rollout?: string; owner: Owner; deadline: string; reserved: { tokens: number; cost: number } };
/** Detach from caller-owned input and freeze every nested record; persisted consumption still validates the identity. */
export function diagnosisGrant(input: Omit<DiagnosisGrant, 'id'>): DiagnosisGrant {
  const grant = validateDiagnosisGrant(structuredClone({ ...input, id: supervisorHash(input) }));
  const freeze = (value: any) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(grant); return grant;
}
export function validateDiagnosisGrant(g: any): DiagnosisGrant {
  advisoryRecord(g, ['version','id','project','ticket','runId','attemptId','incidentId','basis','invocationId','fence','holdId','runtime','dependencies','profile','policy','owner','deadline','reserved',...(g.rollout === undefined ? [] : ['rollout'])]);
  advisoryDemand(g.rollout === undefined || advisoryHash(g.rollout),'invalid rollout identity');
  validateProject(g.project); validateAdvisoryOwner(g.owner); advisoryRecord(g.reserved, ['tokens','cost']);
  advisoryDemand(g.version === 1 && Number.isSafeInteger(g.ticket) && g.ticket > 0 && advisoryText(g.runId)
    && (g.attemptId === null || advisoryText(g.attemptId)) && ['invocationId','fence','holdId'].every(k => advisoryText(g[k]))
    && ['id','incidentId','basis','runtime','dependencies','policy'].every(k => advisoryHash(g[k])) && [ADVISORY_PROFILE_ID, SUBSCRIPTION_PROFILE_ID].includes(g.profile)
    && advisoryTime(g.deadline) && supervisorHash(g.reserved) === supervisorHash(advisoryReservation(g.profile)), 'unsupported or incomplete grant');
  const { id, ...body } = g; advisoryDemand(id === supervisorHash(body), 'grant identity mismatch'); return g;
}
export type ProviderUsage = { input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number; total: number };
export type ProviderUsageReceipt = { version: 1; id: string; grantId: string; authorization: string; invocationId: string; fence: string; profile: string; price: string; rawHash: string;
  requestId: string | null; responseId: string | null; terminalStatus: 'completed' | 'incomplete' | 'failed' | null;
  serviceTier: 'default' | null; cachePolicy: 'explicit-unmarked' | 'provider-managed' | null;
  state: 'known' | 'unknown'; reason: 'complete' | 'identity' | 'terminal' | 'policy' | 'counters' | 'bounds' | 'evidence';
  usage: ProviderUsage | null; resources: { tokens: number; cost: number } | null; costKind: 'derived-upper-micro-usd' | 'subscription-api-invoice-not-applicable' | null };
export function validateProviderUsageReceipt(r: any, g: DiagnosisGrant, a: SendAuthorization): ProviderUsageReceipt {
  validateSendAuthorization(a, g);
  const subscription = subscriptionProfile(g.profile), profile = advisoryProfile(g.profile);
  advisoryRecord(r, ['version','id','grantId','authorization','invocationId','fence','profile','price','rawHash','requestId','responseId','terminalStatus','serviceTier','cachePolicy','state','reason','usage','resources','costKind']);
  advisoryDemand(r.version === 1 && r.grantId === g.id && r.authorization === a.receipt && r.invocationId === g.invocationId && r.fence === g.fence && r.profile === g.profile && r.price === profile.price
    && advisoryHash(r.rawHash) && (r.requestId === null || typeof r.requestId === 'string' && /^req_[A-Za-z0-9_-]{1,180}$/.test(r.requestId))
    && (r.responseId === null || typeof r.responseId === 'string' && /^resp_[A-Za-z0-9_-]{1,180}$/.test(r.responseId))
    && [null,'completed','incomplete','failed'].includes(r.terminalStatus), 'foreign provider receipt');
  if (r.state === 'known') {
    advisoryRecord(r.usage, ['input','cacheRead','cacheWrite','output','reasoning','total']); advisoryRecord(r.resources, ['tokens','cost']);
    advisoryDemand(r.reason === 'complete' && r.serviceTier === 'default' && r.cachePolicy === (subscription ? 'provider-managed' : 'explicit-unmarked') && r.requestId !== null && r.responseId !== null && ['completed','incomplete'].includes(r.terminalStatus)
      && Object.values(r.usage).every(advisoryCount) && r.usage.input > 0 && (subscription || r.usage.input <= ADVISORY_PROFILE.input)
      && r.usage.cacheRead <= r.usage.input && (subscription ? r.usage.cacheWrite <= r.usage.input : r.usage.cacheWrite === 0) && r.usage.reasoning <= r.usage.output && (subscription || r.usage.output <= ADVISORY_PROFILE.output)
      && Number.isSafeInteger(r.usage.input + r.usage.output) && r.usage.total === r.usage.input + r.usage.output
      && r.resources.tokens === r.usage.total && advisoryCount(r.resources.cost) && r.resources.cost <= g.reserved.cost
      && r.costKind === (subscription ? 'subscription-api-invoice-not-applicable' : 'derived-upper-micro-usd'), 'invalid known provider receipt');
    const p = ADVISORY_PROFILE, numerator = BigInt(r.usage.input) * BigInt(p.inputMicroNumerator) + BigInt(r.usage.output) * BigInt(p.outputMicroNumerator);
    advisoryDemand(r.resources.cost === (subscription ? 0 : Number((numerator + BigInt(p.denominator - 1)) / BigInt(p.denominator))), 'derived provider charge mismatch');
  } else advisoryDemand(r.state === 'unknown' && ['identity','terminal','policy','counters','bounds','evidence'].includes(r.reason)
    && r.usage === null && r.resources === null && r.costKind === null && r.serviceTier === null && r.cachePolicy === null, 'unknown usage cannot imply zero');
  const { id, ...body } = r; advisoryDemand(id === supervisorHash(body), 'provider receipt identity mismatch'); return r;
}

export type SendAuthorization = { version: 1; grantId: string; invocationId: string; fence: string; worker: Owner;
  profile: string; payload: string; at: string; receipt: string };
export function validateSendAuthorization(a: any, g: DiagnosisGrant): SendAuthorization {
  validateDiagnosisGrant(g); advisoryRecord(a, ['version','grantId','invocationId','fence','worker','profile','payload','at','receipt']);
  validateAdvisoryOwner(a.worker);
  advisoryDemand(a.version === 1 && a.grantId === g.id && a.invocationId === g.invocationId && a.fence === g.fence
    && a.profile === g.profile && advisoryHash(a.payload) && advisoryTime(a.at) && a.at < g.deadline
    && supervisorHash(a.worker) === supervisorHash(g.owner), 'authorization binding mismatch');
  const { receipt, ...body } = a; advisoryDemand(receipt === supervisorHash(body), 'authorization receipt mismatch'); return a;
}
