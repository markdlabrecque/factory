// Recovery preparation protocol. Only an exact execution manifest/base identity can authorize admission.
import { createHash } from 'node:crypto';
export type PreparationCode = 'ready' | 'changed' | 'stale' | 'unmet-dependency' | 'unknown-dependency' | 'analysis-failed' | 'timeout' | 'ownership' | 'config' | 'eligibility' | 'ticket-input';
export type Preparation = { version: 1; state: 'held' | 'error'; code: PreparationCode; reason: string; scope: 'ticket' | 'project' }
  | { version: 1; state: 'ready'; code: 'ready'; reason: string; scope: 'ticket'; project: string; ticket: number; root: string; base: string;
    requirementsHash: string; baseSha: string; analysisKey: string; manifestDigest: string };
export type Prepared = Extract<Preparation, { state: 'ready' }>;
export const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
export const held = (code: PreparationCode, reason: string, scope: 'ticket' | 'project' = 'ticket'): Preparation =>
  ({ version: 1, state: 'held', code, reason: reason.slice(0, 1000), scope });
export function validPreparation(v: any): v is Preparation {
  if (!v || v.version !== 1 || !['ready','held','error'].includes(v.state) || !['ticket','project'].includes(v.scope)
    || typeof v.reason !== 'string' || v.reason.length > 1000 || !['ready','changed','stale','unmet-dependency','unknown-dependency','analysis-failed','timeout','ownership','config','eligibility','ticket-input'].includes(v.code)) return false;
  return v.state !== 'ready' ? v.code !== 'ready' : v.code === 'ready' && v.scope === 'ticket'
    && ['project','root','base','requirementsHash'].every(k => typeof v[k] === 'string' && v[k].length > 0)
    && ['analysisKey','manifestDigest'].every(k => /^[a-f0-9]{64}$/.test(v[k])) && /^[a-f0-9]{40,64}$/.test(v.baseSha)
    && Number.isSafeInteger(v.ticket) && v.ticket > 0;
}
