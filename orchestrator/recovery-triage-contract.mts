// Pure, versioned recovery-triage protocols and stop identity shared by the helper and host.
import { createHash } from 'node:crypto';

export const TRIAGE_STDOUT_LIMIT = 16 * 1024;
export const TRIAGE_MODEL_LIMIT = 16 * 1024;
export const TRIAGE_TEXT_LIMIT = 2048; // UTF-8 bytes per model field
export const TRIAGE_RELATED_LIMIT = 10;

const fields = {
  repair: ['expectation'],
  escalate: ['question', 'nextAction'],
  'gate-change': ['path', 'before', 'after', 'rationale', 'risks'],
  'follow-up-draft': ['title', 'body'],
  wait: ['expectation'],
} as const;
type Kind = keyof typeof fields;
export type TriageAction = { [K in Kind]: { kind: K } & Record<(typeof fields)[K][number], string> }[Kind];
export type TriageAdvice = { version: 1; classification: 'problem' | 'evidence-mechanism' | 'expectation';
  cause: string; rationale: string; relatedTickets: number[]; action: TriageAction };
export type HumanAction = Exclude<Kind, 'repair'>;
export type Delivery = 'delivered' | 'pending';
export type TriageResult = { version: 1; fresh: boolean; key: string | null; reason: string } & (
  { state: 'repair' | 'released'; key: string } | { state: 'unavailable' } |
  { state: 'human'; key: string; action: HumanAction; cause: string; delivery: Delivery });

export const TRIAGE_OUTPUT_SCHEMA = `version: 1
classification: "problem" | "evidence-mechanism" | "expectation"
cause: string
rationale: string
relatedTickets: array of at most ${TRIAGE_RELATED_LIMIT} distinct positive safe integer ticket numbers (use [] when none)
action: exactly one of the following objects:
${Object.entries(fields).map(([kind, names]) => `  { "kind": "${kind}", ${names.map(n => `"${n}": string`).join(', ')} }`).join('\n')}
All top-level and action fields are required; no extra fields. Each string is nonblank and at most ${TRIAGE_TEXT_LIMIT} UTF-8 bytes. The entire JSON reply is at most ${TRIAGE_MODEL_LIMIT} UTF-8 bytes.`;

export const isStopKey = (key: unknown): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
export const isTriageText = (s: unknown): s is string => typeof s === 'string' && !!s.trim() && Buffer.byteLength(s) <= TRIAGE_TEXT_LIMIT;
export const isHumanAction = (kind: unknown): kind is HumanAction => typeof kind === 'string' && kind !== 'repair' && Object.hasOwn(fields, kind);
export function hasFields(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
export function validTriageAdvice(value: unknown): value is TriageAdvice {
  if (!hasFields(value, ['version', 'classification', 'cause', 'rationale', 'relatedTickets', 'action']) || value.version !== 1 ||
    !['problem', 'evidence-mechanism', 'expectation'].some(c => c === value.classification) || !isTriageText(value.cause) || !isTriageText(value.rationale) ||
    !Array.isArray(value.relatedTickets) || value.relatedTickets.length > TRIAGE_RELATED_LIMIT ||
    new Set(value.relatedTickets).size !== value.relatedTickets.length || !value.relatedTickets.every(n => Number.isSafeInteger(n) && n > 0)) return false;
  const action = value.action as Record<string, unknown> | null | undefined, kind = action?.kind;
  if (kind !== 'repair' && !isHumanAction(kind)) return false;
  const names = fields[kind];
  return hasFields(action, ['kind', ...names]) && names.every(field => isTriageText(action[field]));
}
export function parseTriageAdvice(reply: string): TriageAdvice {
  if (Buffer.byteLength(reply) <= TRIAGE_MODEL_LIMIT) {
    try { const value: unknown = JSON.parse(reply); if (validTriageAdvice(value)) return value; } catch { /* Invalid JSON. */ }
  }
  throw Error('Invalid recovery triage model result');
}
export function parseTriageResult(reply: string): TriageResult {
  if (Buffer.byteLength(reply) <= TRIAGE_STDOUT_LIMIT) {
    const common = ['version', 'state', 'fresh', 'key', 'reason'];
    try {
      const value = JSON.parse(reply);
      if (hasFields(value, value?.state === 'human' ? [...common, 'action', 'cause', 'delivery'] : common) &&
        value.version === 1 && typeof value.fresh === 'boolean' && isTriageText(value.reason)) {
        if (value.state === 'unavailable' && (value.key === null || isStopKey(value.key))) return value as TriageResult;
        if (isStopKey(value.key) && ((value.state === 'repair' || value.state === 'released') ||
          (value.state === 'human' && isHumanAction(value.action) && isTriageText(value.cause) && ['delivered', 'pending'].some(d => d === value.delivery)))) return value as TriageResult;
      }
    } catch { /* Invalid JSON. */ }
  }
  throw Error('Invalid recovery triage helper result');
}

export const unavailable = (reason: string, key: string | null = null, fresh = false): TriageResult =>
  ({ version: 1, state: 'unavailable', fresh, key, reason });

export interface StopIdentity {
  project: string; ticket: number; executionId: string; stage: string; stageSince: string; note?: string;
  tip: string; inputHash: string; prompt: string; model: string;
}
export function stopKey(i: StopIdentity): string {
  return createHash('sha256').update(JSON.stringify([i.project, i.ticket, i.executionId, i.stage, i.stageSince, i.note ?? null,
    i.tip, i.inputHash, i.prompt, i.model])).digest('hex');
}
