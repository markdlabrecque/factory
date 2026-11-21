// Synthetic independent preparation for admission fixtures, performed before launching the selected runtime.
// This is not shipped and must never be used as production review or execution authorization.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { acceptanceHash, acceptanceIdentity, type AcceptanceContract, type ApprovalRecord } from '../acceptance-contract.mts';
import { freezeAcceptanceBundle, readAcceptanceBundle } from '../acceptance-custody.mts';
import { frozenTicketIdentity, type FrozenTicketInput } from '../ticket-input.mts';
import { execFileSync } from 'node:child_process';

/** Collect the exact fixture tracker originals before a real selected entrypoint runs. */
export function prepareFixtureFromRuntime(runtime: string, cwd: string, env: NodeJS.ProcessEnv, iid = 7): void {
  const input = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `const t=await import(${JSON.stringify(join(runtime, 'tracker.mts'))}); const g=await import(${JSON.stringify(join(runtime, 'ticket-input.mts'))}); process.stdout.write(JSON.stringify(g.freezeTicketInput(t.contextSource, ${iid})));`],
    {cwd, env, encoding: 'utf8', timeout: 20_000}));
  if (!existsSync(join(env.SANDCASTLE_STATE_DIR!, 'acceptance', `prepared-${input.hash}.json`))) prepareFixtureAcceptance(env.SANDCASTLE_STATE_DIR!, input);
}

export function prepareFixtureAcceptance(stateRoot: string, input: FrozenTicketInput): string {
  const root = join(stateRoot, 'acceptance');
  mkdirSync(root, { mode: 0o700, recursive: true });
  const contract = JSON.parse(readFileSync(new URL('../../docs/acceptance-contract.md', import.meta.url), 'utf8').match(/```json\n([\s\S]*?)\n```/)![1]) as AcceptanceContract;
  const artifacts = [{ path: 'probes/export.mjs', bytes: Buffer.from('/* fixture reviewed probe; never executed here */') }, { path: 'fixtures/rows.json', bytes: Buffer.from('[1,2]') }];
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  contract.probes[0].bundle[0].sha256 = sha(artifacts[0].bytes);
  contract.fixtures[0].sha256 = sha(artifacts[1].bytes);
  const identity = acceptanceIdentity(contract), ticket = frozenTicketIdentity(input);
  const approval: ApprovalRecord = { version: 1, id: 'fixture-review', identity, approvedRevision: contract.revision,
    reviewer: { kind: 'independent-reviewer', name: 'reviewer@example.invalid' }, decision: 'approve', semanticAdequacy: true,
    provenance: 'fixture-owned-independent-review', reviewedAt: '2026-11-20T16:00:00.000Z' };
  const pointer = freezeAcceptanceBundle({ root, agentMounts: [], ticket: input, contract, artifacts,
    approvals: { lookup: binding => acceptanceHash(binding) === acceptanceHash({ ticket, acceptance: identity }) ? approval : undefined } });
  const bundle = readAcceptanceBundle(root, [], pointer);
  const file = join(root, `prepared-${input.hash}.json`);
  writeFileSync(file, JSON.stringify({ version: 1, bundle: pointer, ticket, acceptance: identity, approvalDigest: bundle.manifest.approvalDigest }), { mode: 0o600, flag: 'wx' });
  return file;
}
