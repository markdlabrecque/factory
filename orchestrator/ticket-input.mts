// Host-owned frozen ticket input and evidence. Collection failures are typed ticket-only holds, never partial prompts.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectTicketContext, renderTicketContext } from './ticket-context.mts';
import type { ReadinessCheck } from './readiness-schema.mts';
import type { TicketContext, TicketContextHold, TicketContextSource } from './ticket-context.mts';

export class TicketInputHold extends Error {
  readonly hold: TicketContextHold;
  readonly check: ReadinessCheck;
  constructor(hold: TicketContextHold) {
    super(`Ticket-input hold: ${hold.source} #${hold.sourceIid} ${hold.operation}: ${hold.reason}. ${hold.nextAction}`);
    this.hold = hold;
    this.check = ticketInputCheck(hold);
  }
}
/** Shared diagnostic shape; callers must not overwrite the project filesystem report with a ticket-only hold. */
export function ticketInputCheck(hold: TicketContextHold, observedAt = new Date().toISOString()): ReadinessCheck {
  return { id: `ticket-input-${hold.iid}`, scope: 'ticket-input', phase: 'passive', observedAt, status: 'blocked', required: true,
    operation: `${hold.source} ${hold.operation}`, path: `${hold.identity.kind}://${hold.identity.host}/${hold.identity.project}/${hold.sourceIid}`,
    reason: hold.reason, nextActor: hold.nextActor, nextAction: hold.nextAction, automaticRecheck: 'next-launch' };
}
export interface FrozenTicketInput { context: TicketContext; text: string; hash: string; textHash: string }
export function freezeTicketInput(source: TicketContextSource, iid: number): FrozenTicketInput {
  const result = collectTicketContext(source, iid);
  if (result.status === 'hold') throw new TicketInputHold(result);
  const text = renderTicketContext(result.context);
  return { context: result.context, text, hash: result.context.contentHash,
    textHash: createHash('sha256').update(text).digest('hex') };
}
/** Write outside agent mounts. The rendered bytes are exactly the TICKET prompt argument, without a trailing newline. */
export function saveTicketInput(directory: string, input: FrozenTicketInput): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, 'ticket-context.json'), JSON.stringify(input.context, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'ticket-context.txt'), input.text, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'ticket-sources.json'), JSON.stringify({ version: 1, contentHash: input.hash,
    renderedSha256: input.textHash, identity: input.context.identity, coverage: input.context.coverage,
    collection: input.context.collection }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
