// Validate actual provider metadata independently of Pi counters; retain one private atomic record. No refund, cleanup or execution authority.
import { existsSync, constants, openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync, mkdirSync, fsyncSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { ADVISORY_PROFILE, advisoryProfile, subscriptionProfile, validateDiagnosisGrant, validateSendAuthorization, validateProviderUsageReceipt,
  advisoryRecord, advisoryDemand, advisoryCount } from './supervisor-advisory-contract.mts';
import type { DiagnosisGrant, SendAuthorization, ProviderUsageReceipt, ProviderUsage } from './supervisor-advisory-contract.mts';
import { readSupervisor, readSupervisorProjects } from './supervisor-state.mts';
const flat = existsSync(new URL('./admission.mts', import.meta.url));
const { withAdmissionLock, syncDirectory } = await import(flat ? './admission.mts' : '../../board/admission.mts');
const { supervisorHash } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export const PROVIDER_EVIDENCE_BYTES = 65_536;
export type RawProviderEvidence = { version: 1; grantId: string | null; authorization: string | null; response: any;
  terminal: any; terminalProblem: string | null; streamComplete: boolean };
const requestId = (v: unknown): v is string => typeof v === 'string' && /^req_[A-Za-z0-9_-]{1,180}$/.test(v);
const responseId = (v: unknown): v is string => typeof v === 'string' && /^resp_[A-Za-z0-9_-]{1,180}$/.test(v);
/** Select original provider metadata only. Never retain Pi counters, prompts/output, error prose or auth/header values. */
export function captureProviderEvidence(result: any): RawProviderEvidence {
  const t = result?.terminal, r = t?.response;
  const raw = { version: 1 as const, grantId: result?.authorization?.grantId ?? null, authorization: result?.authorization?.receipt ?? null,
    response: result?.response ? { status: result.response.status, requestId: result.response.requestId } : null,
    terminal: t ? { type: t.type, response: r ? { id: r.id, model: r.model, status: r.status, service_tier: r.service_tier,
      usage: r.usage, incomplete_details: r.incomplete_details } : null } : null,
    terminalProblem: result?.terminalProblem === null ? null : 'missing-or-ambiguous-terminal-integrity',
    streamComplete: ['stop','length'].includes(result?.result?.stopReason) };
  try {
    const text = JSON.stringify(raw); if (Buffer.byteLength(text) > PROVIDER_EVIDENCE_BYTES) throw Error();
    return JSON.parse(text);
  } catch { return { version: 1, grantId: null, authorization: null, response: null, terminal: null,
    terminalProblem: 'malformed-or-oversize-provider-evidence', streamComplete: false }; }
}
/** Price is a conservative derived profile charge, not measured account dollars. Reasoning is already in output. */
function resources(u: ProviderUsage, subscription = false) {
  if (subscription) return { tokens: u.total, cost: 0 };
  const p = ADVISORY_PROFILE, n = BigInt(u.input) * BigInt(p.inputMicroNumerator) + BigInt(u.output) * BigInt(p.outputMicroNumerator);
  return { tokens: u.total, cost: Number((n + BigInt(p.denominator - 1)) / BigInt(p.denominator)) };
}
export function providerUsage(g: DiagnosisGrant, a: SendAuthorization, raw: RawProviderEvidence): ProviderUsageReceipt {
  validateDiagnosisGrant(g); validateSendAuthorization(a, g);
  const subscription = subscriptionProfile(g.profile), profile = advisoryProfile(g.profile);
  let reason: ProviderUsageReceipt['reason'] = 'evidence', usage: ProviderUsage | null = null;
  // Inputs to this function are bounded selected metadata; malformed/cyclic objects cannot become fabricated zero usage.
  try { advisoryDemand(Buffer.byteLength(JSON.stringify(raw)) <= PROVIDER_EVIDENCE_BYTES, 'oversize evidence'); supervisorHash(raw); }
  catch { raw = captureProviderEvidence(null); }
  const status = raw?.terminal?.response?.status;
  const base = { version: 1 as const, grantId: g.id, authorization: a.receipt, invocationId: g.invocationId, fence: g.fence,
    profile: g.profile, price: profile.price, rawHash: supervisorHash(raw),
    requestId: requestId(raw?.response?.requestId) ? raw.response.requestId : null,
    responseId: responseId(raw?.terminal?.response?.id) ? raw.terminal.response.id : null,
    terminalStatus: ['completed','incomplete','failed'].includes(status) ? status as 'completed' | 'incomplete' | 'failed' : null };
  try {
    advisoryRecord(raw, ['version','grantId','authorization','response','terminal','terminalProblem','streamComplete']);
    advisoryDemand(raw.version === 1, 'unknown evidence schema');
    reason = 'identity';
    advisoryDemand(raw.grantId === g.id && raw.authorization === a.receipt && base.requestId && base.responseId
      && raw.terminal?.response?.model === ADVISORY_PROFILE.model, 'foreign request/model/invocation');
    reason = 'terminal';
    advisoryRecord(raw.response, ['status','requestId']); advisoryRecord(raw.terminal, ['type','response']);
    advisoryRecord(raw.terminal.response, ['id','model','status','service_tier','usage', ...(Object.hasOwn(raw.terminal.response,'incomplete_details') ? ['incomplete_details'] : [])]);
    advisoryDemand(raw.response.status === 200 && raw.terminalProblem === null && raw.streamComplete === true
      && [['response.completed','completed'],['response.incomplete','incomplete']].some(([type,s]) => raw.terminal.type === type && status === s), 'missing/failed/truncated terminal stream');
    const incomplete = raw.terminal.response.incomplete_details;
    if (incomplete !== undefined && incomplete !== null) advisoryRecord(incomplete, ['reason']);
    advisoryDemand(status === 'completed' ? incomplete === undefined || incomplete === null
      : incomplete && ['max_output_tokens','content_filter'].includes(incomplete.reason) && Object.keys(incomplete).length === 1, 'unsupported terminal reason');
    reason = 'policy'; advisoryDemand(raw.terminal.response.service_tier === 'default', 'unsupported service tier');
    const u = raw.terminal.response.usage; reason = 'counters';
    advisoryRecord(u, ['input_tokens','input_tokens_details','output_tokens','output_tokens_details','total_tokens']);
    const d = u.input_tokens_details;
    advisoryRecord(d, ['cached_tokens','cache_write_tokens', ...(Object.hasOwn(d ?? {}, 'cache_write_tokens_details') ? ['cache_write_tokens_details'] : [])]);
    advisoryRecord(u.output_tokens_details, ['reasoning_tokens']);
    const values = [u.input_tokens,d.cached_tokens,d.cache_write_tokens,u.output_tokens,u.output_tokens_details.reasoning_tokens,u.total_tokens];
    advisoryDemand(values.every(advisoryCount) && u.input_tokens > 0 && d.cached_tokens <= u.input_tokens && (subscription ? d.cache_write_tokens <= u.input_tokens : d.cache_write_tokens === 0)
      && u.output_tokens_details.reasoning_tokens <= u.output_tokens && Number.isSafeInteger(u.input_tokens + u.output_tokens)
      && u.total_tokens === u.input_tokens + u.output_tokens, 'missing/inconsistent counters or unexpected cache write');
    // No write is permitted by this profile. Explicit authoritative write=0 needs no invented retention-specific API field.
    // If optional breakdown exists it must agree with zero; a positive write remains unknown, whatever its retention.
    if (!subscription && Object.hasOwn(d, 'cache_write_tokens_details')) {
      advisoryRecord(d.cache_write_tokens_details, ['ttl_30m_tokens','ttl_12h_tokens']);
      advisoryDemand(d.cache_write_tokens_details.ttl_30m_tokens === 0 && d.cache_write_tokens_details.ttl_12h_tokens === 0, 'cache retention contradicts zero writes');
    }
    reason = 'bounds'; advisoryDemand(subscription || u.input_tokens <= ADVISORY_PROFILE.input && u.output_tokens <= ADVISORY_PROFILE.output
      && u.total_tokens <= g.reserved.tokens, 'usage exceeds reservation');
    usage = { input: u.input_tokens, cacheRead: d.cached_tokens, cacheWrite: d.cache_write_tokens, output: u.output_tokens,
      reasoning: u.output_tokens_details.reasoning_tokens, total: u.total_tokens };
    advisoryDemand(resources(usage, subscription).cost <= g.reserved.cost, 'cost exceeds reservation'); reason = 'complete';
  } catch { usage = null; }
  const body = { ...base, state: usage ? 'known' as const : 'unknown' as const, reason, usage,
    resources: usage ? resources(usage, subscription) : null, costKind: usage ? (subscription ? 'subscription-api-invoice-not-applicable' as const : 'derived-upper-micro-usd' as const) : null,
    serviceTier: usage ? 'default' as const : null, cachePolicy: usage ? (subscription ? 'provider-managed' as const : 'explicit-unmarked' as const) : null };
  return validateProviderUsageReceipt({ ...body, id: supervisorHash(body) }, g, a);
}

function journalBinding(stateDir: string, g: DiagnosisGrant, a: SendAuthorization) {
  validateDiagnosisGrant(g); validateSendAuthorization(a, g);
  const s = readSupervisor(stateDir, g.project), key = supervisorHash(g.invocationId);
  advisoryDemand(s.advisory?.workers[key]?.grant.id === g.id && s.advisory?.sends[key]?.receipt === a.receipt, 'no matching durable journal authorization');
}
function location(stateDir: string, g: DiagnosisGrant, create: boolean) {
  advisoryDemand(typeof process.getuid === 'function' && resolve(stateDir) === stateDir && realpathSync(stateDir) === stateDir, 'canonical owned host state required');
  for (const p of [g.project, ...readSupervisorProjects(stateDir).map(s => s.project)]) {
    const rel = relative(p.root, stateDir); advisoryDemand(rel === '..' || rel.startsWith(`..${sep}`), 'provider receipt is inside a project');
  }
  let dir = stateDir;
  const root = lstatSync(dir); advisoryDemand(root.isDirectory() && root.uid === process.getuid() && (root.mode & 0o022) === 0, 'unsafe host state directory');
  for (const segment of ['supervisor','usage',supervisorHash(g.project),supervisorHash(g.invocationId)]) {
    dir = join(dir, segment);
    if (create) { try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
    const st = lstatSync(dir); advisoryDemand(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0, 'unsafe private receipt directory');
  }
  if (create) {
    const lock = join(dir,'admission');
    try { mkdirSync(lock, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const st = lstatSync(lock);
    advisoryDemand(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0 && realpathSync(lock) === lock,
      'unsafe private receipt lock directory');
  }
  return { dir, file: join(dir, 'terminal.json') };
}
function reopen(file: string, g: DiagnosisGrant, a: SendAuthorization) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd); advisoryDemand(st.isFile() && st.nlink === 1 && st.uid === process.getuid!() && (st.mode & 0o077) === 0
      && st.size > 0 && st.size <= PROVIDER_EVIDENCE_BYTES + 16384, 'unsafe/oversize receipt file');
    const b = Buffer.alloc(PROVIDER_EVIDENCE_BYTES + 16385), count = readSync(fd, b, 0, b.length, 0), after = fstatSync(fd);
    advisoryDemand(count === st.size && st.size === after.size && st.mtimeMs === after.mtimeMs && st.ctimeMs === after.ctimeMs, 'receipt changed during read');
    const value = JSON.parse(b.subarray(0,count).toString('utf8'));
    advisoryRecord(value, ['version','grantId','authorization','raw','receipt']);
    advisoryDemand(value.version === 1 && value.grantId === g.id && value.authorization === a.receipt, 'foreign provider record');
    validateProviderUsageReceipt(value.receipt, g, a);
    advisoryDemand(supervisorHash(providerUsage(g,a,value.raw)) === supervisorHash(value.receipt), 'raw/scalar receipt disagreement');
    // A prior publisher may have failed after rename. Visibility alone is not a durable-known result.
    fsyncSync(fd); syncDirectory(dirname(file)); return value;
  } finally { closeSync(fd); }
}
/** One atomic record contains bounded original provider metadata and its scalar derivation; no mismatched record is replaced. */
export function persistProviderUsage(stateDir: string, g: DiagnosisGrant, a: SendAuthorization, raw: RawProviderEvidence) {
  journalBinding(stateDir,g,a); const { dir, file } = location(stateDir,g,true), receipt = providerUsage(g,a,raw);
  const record = { version: 1, grantId: g.id, authorization: a.receipt, raw, receipt }, text = JSON.stringify(record) + '\n';
  advisoryDemand(Buffer.byteLength(text) <= PROVIDER_EVIDENCE_BYTES + 16384, 'provider record too large');
  return withAdmissionLock(dir, write => {
    let present = false;
    try { lstatSync(file); present = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (present) {
      const previous = reopen(file,g,a);
      advisoryDemand(supervisorHash(previous) === supervisorHash(record), 'existing provider record differs; no replacement'); return { file, receipt: previous.receipt as ProviderUsageReceipt };
    }
    write(file,text); const stored = reopen(file,g,a); return { file, receipt: stored.receipt as ProviderUsageReceipt };
  }, -1);
}
/** Missing/corrupt/foreign state is unknown, never a known zero. Reading never creates, repairs, authorizes or settles anything. */
export function readProviderUsage(stateDir: string, g: DiagnosisGrant, a: SendAuthorization):
  { state: 'known'; file: string; receipt: ProviderUsageReceipt } | { state: 'unknown'; reason: string; receipt?: ProviderUsageReceipt } {
  try {
    journalBinding(stateDir,g,a); const { file } = location(stateDir,g,false), value = reopen(file,g,a);
    return value.receipt.state === 'known' ? { state: 'known', file, receipt: value.receipt } : { state: 'unknown', reason: value.receipt.reason, receipt: value.receipt };
  } catch { return { state: 'unknown', reason: 'missing-or-invalid-provider-receipt' }; }
}
export function providerResources(stateDir: string, g: DiagnosisGrant, a: SendAuthorization) {
  const value = readProviderUsage(stateDir,g,a); return value.state === 'known' ? structuredClone(value.receipt.resources) : null;
}
