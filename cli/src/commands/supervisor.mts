// Exact human-request resolution at the existing local host-user boundary; no mode switch, notification or action launch.
import { userInfo } from 'node:os';
import { realpathSync } from 'node:fs';
import type { Paths } from '../paths.mts';
import { resolveProject, runStateDir } from '../runs.mts';
import { tomlIdentity } from '../../../orchestrator/project-config.mts';
import { resolveSupervisorRequest } from '../supervisor-escalation.mts';
export function supervisorResolve(p: Paths, action: string | undefined, extra: string[], o: {
  project?: string; incident?: string; request?: string; proposal?: string; reason?: string; revised?: string; abandon?: boolean; confirm?: boolean;
}): number {
  if (action !== 'resolve' || extra.length) throw Error('Expected factory supervisor resolve with exact --incident --request --proposal --reason and --confirm');
  if (!o.confirm || !o.incident || !o.request || !o.proposal || !o.reason || (!!o.revised === !!o.abandon)) throw Error('Resolution requires --confirm, exact incident/request/proposal, reason and exactly one of --abandon or --revised <new-proposal-hash>');
  const ctx=resolveProject(p,{project:o.project});
  const identity=tomlIdentity(ctx.scaffold);
  // Do not accept a user-supplied actor or environment USER; the invoking host OS identity owns this control.
  const user=userInfo();
  const state=resolveSupervisorRequest({stateDir:runStateDir(p),project:{root:realpathSync(ctx.root),tracker:identity},incidentId:o.incident,requestId:o.request,
    proposalId:o.proposal,actor:`uid:${user.uid}:${user.username}`,reason:o.reason,nextProposalId:o.revised??null});
  console.log(`Recorded exact local resolution at revision ${state.revision}. Original denial/work/charges retained; no approval, action or automatic resume.`);
  return 0;
}
