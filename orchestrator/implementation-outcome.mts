// Validate untrusted, execution-bound implementation reports and decide whether the host may resume once.
import { addAbortListener } from 'node:events';
import { resolve } from 'node:path';
import { readBoundedText } from './ownership.mts';
import { sanitizeReply, type NoCommitDiagnostic } from './no-commit.mts';

export type ImplementationTurn = 'initial' | 'continuation';
export const outcomeFile = (turn: ImplementationTurn) => `implementation-${turn}-outcome.json`;
export type ImplementationOutcome =
  | { status: 'missing' | 'invalid' }
  | { status: 'implemented' | 'blocked' | 'incomplete'; reason: string; nextAction: string };

export function readImplementationOutcome(dir: string, executionId: string, turn: ImplementationTurn): ImplementationOutcome {
  try {
    const row = JSON.parse(readBoundedText(resolve(dir, outcomeFile(turn)), 4096, 'implementation outcome'));
    if (!row || Object.keys(row).sort().join(',') !== 'executionId,nextAction,reason,status,turn,version'
      || row.version !== 1 || row.executionId !== executionId || row.turn !== turn
      || !['implemented', 'blocked', 'incomplete'].includes(row.status)
      || ![row.reason, row.nextAction].every(text => typeof text === 'string' && text.length <= 1000 && sanitizeReply(text))) return { status: 'invalid' };
    return { status: row.status, reason: sanitizeReply(row.reason), nextAction: sanitizeReply(row.nextAction) };
  } catch (error) {
    return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid' };
  }
}

export function continuationRefusal(facts: {
  outcome: ImplementationOutcome; worktree: NoCommitDiagnostic['worktree']; dependencyReport: boolean;
  zeroCommits: boolean; replyCaptured: boolean; canResume: boolean; cancelled: boolean; remainingMs: number;
}): string | undefined {
  if (facts.cancelled) return 'continuation refused: execution cancelled';
  if (facts.dependencyReport) return 'continuation refused: dependency report present';
  if (facts.outcome.status !== 'incomplete') return `continuation refused: implementation outcome ${facts.outcome.status}`;
  if (!facts.zeroCommits) return 'continuation refused: zero commits not confirmed';
  if (facts.worktree !== 'clean') return `continuation refused: worktree ${facts.worktree}`;
  if (!facts.replyCaptured || !facts.canResume) return 'continuation refused: readable resumable Pi session unavailable';
  if (!(facts.remainingMs > 0)) return 'continuation refused: shared implementation time exhausted';
  return undefined;
}

/** Bound the host wait as well as the SDK agent command. The caller still owns any unsettled SDK work. */
export async function waitForContinuation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let listener: ReturnType<typeof addAbortListener> | undefined;
  const abort = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else listener = addAbortListener(signal, () => reject(signal.reason));
  });
  try { return await Promise.race([work, abort]); }
  finally { listener?.[Symbol.dispose](); }
}
