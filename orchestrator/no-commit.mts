// Bounded, attributed implementer diagnostics only. Never grants success, dependency or retry authority.
import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync, realpathSync } from 'node:fs';
import { relative, resolve, isAbsolute } from 'node:path';
import { attentionText } from './readiness-schema.mts';

export const MAX_SESSION_BYTES = 256 * 1024;
export const MAX_REPLY_CHARS = 4096;
export function sanitizeReply(text: string): string {
  return text.slice(0, MAX_SESSION_BYTES).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/(?:https?:\/\/)[^\s<>]+/gi, '[url redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, '[credential redacted]')
    .replace(/\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, '[credential redacted]')
    .replace(/\/[^\s<>"'`]+/g, '[path redacted]').trim().slice(0, MAX_REPLY_CHARS);
}

/** Pi captured JSONL is structured session data, not the SDK stdout fallback or a human log. */
export function finalReply(result: { iterations?: { sessionFilePath?: string }[] }, sessionRoot: string): string | undefined {
  const file = result.iterations?.at(-1)?.sessionFilePath;
  if (!file) return undefined;
  const rel = relative(resolve(sessionRoot), resolve(file));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  let fd: number | undefined;
  try {
    const actual = relative(realpathSync(sessionRoot), realpathSync(file));
    if (!actual || actual.startsWith('..') || isAbsolute(actual)) return undefined;
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_SESSION_BYTES) return undefined;
    const buffer = Buffer.alloc(MAX_SESSION_BYTES + 1);
    let count = 0, n = 0;
    while (count < buffer.length && (n = readSync(fd, buffer, count, buffer.length - count, null))) count += n;
    if (count > MAX_SESSION_BYTES) return undefined;
    const rows = buffer.subarray(0, count).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const messages = rows.filter(row => row.type === 'message').map(row => row.message);
    const last = messages.at(-1);
    if (last?.role !== 'assistant' || last.stopReason !== 'stop' || !Array.isArray(last.content)) return undefined;
    const text = last.content.filter((b: any) => b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
    return sanitizeReply(text) || undefined;
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export interface NoCommitDiagnostic {
  version: 1;
  executionId: string;
  phase: 'implementing';
  commits: 0;
  worktree: 'dirty' | 'clean' | 'unknown';
  push: 'not-attempted';
  dependencyReport: 'present' | 'missing';
  logReference: string;
  agentReply?: string;
  nextActor: 'operator' | 'factory';
  nextAction: string;
  automaticAction: string;
  evidence: 'no-commit.json';
}
export function diagnostic(executionId: string, worktree: NoCommitDiagnostic['worktree'], dependencyReport: boolean, agentReply?: string, logFilePath?: string): NoCommitDiagnostic {
  const log = logFilePath && relative(resolve('.factory/logs'), resolve(logFilePath));
  const logReference = log && /^[A-Za-z0-9_.-]{1,160}\.log$/.test(log) && !log.startsWith('..') ? `.factory/logs/${log}` : 'unavailable';
  return { version: 1, executionId, phase: 'implementing', commits: 0, worktree, push: 'not-attempted',
    dependencyReport: dependencyReport ? 'present' : 'missing', agentReply, logReference,
    nextActor: dependencyReport ? 'factory' : 'operator', nextAction: dependencyReport
      ? 'Evaluate the dependency report using existing blocked-report policy; inspect ticket context and execution evidence if human review is required.'
      : 'Inspect ticket context and execution evidence before deciding whether to relaunch.',
    automaticAction: dependencyReport ? 'Existing blocked-report dependency policy only; explanation grants no retry authority.' : 'None. No automatic retry.',
    evidence: 'no-commit.json' };
}
export function diagnosticText(d: NoCommitDiagnostic, evidenceSaved = true): string {
  return attentionText({ observed: `zero commits; worktree ${d.worktree}; phase ${d.phase}; push ${d.push}; dependency report ${d.dependencyReport}`,
    agentReported: d.agentReply, nextActor: d.nextActor, nextAction: d.nextAction,
    automaticAction: d.automaticAction, evidence: `${evidenceSaved ? `${d.executionId}/${d.evidence}` : 'diagnostic unavailable'}; SDK log ${d.logReference}` }) + ' Agent claims are not verified success.';
}
/** Only writes this execution's fixed artifact. The caller's fenced stage write publishes its pointer. */
export function saveDiagnostic(evidenceHost: string, d: NoCommitDiagnostic): void {
  writeFileSync(resolve(evidenceHost, d.evidence), JSON.stringify(d, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
