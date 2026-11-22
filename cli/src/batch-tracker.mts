// Resolve only explicitly submitted IDs against the configured repository. Never discover by label or expand parents.
import { execFileSync } from 'node:child_process';
import type { EffectiveConfig } from '../../orchestrator/project-config.mts';

export function batchMembers(ids: string[]): number[] {
  if (!ids.length || ids.some(s => !/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) || new Set(ids).size !== ids.length)
    throw Error('Expected distinct positive project-local ticket numbers');
  return ids.map(Number);
}

export function resolveMembers(config: EffectiveConfig, members: number[]): void {
  const t = config.TRACKER;
  for (const iid of members) {
    const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 1 << 20,
      env: { ...process.env, GH_HOST: t.host }, stdio: ['ignore','pipe','pipe'] }).trim();
    let runnable = false;
    try {
      if (t.kind === 'github') {
        const [owner, name] = t.project.split('/').map(s => JSON.stringify(s));
        const query = `{repository(owner:${owner},name:${name}) {nameWithOwner issue(number:${iid}) {number state subIssues(first:1) {totalCount}}}}`;
        // gh-axi emits TOON for objects; project the response to one strict integer, retaining error/identity checks.
        const filter = `if (.errors // [] | length) == 0 and .data.repository.nameWithOwner == ${JSON.stringify(t.project)} and .data.repository.issue.state == "OPEN"${config.SUBTASKS.enabled ? ' and .data.repository.issue.subIssues.totalCount == 0' : ''} then .data.repository.issue.number else 0 end`;
        runnable = run('gh-axi', ['api','POST','graphql','--field',`query=${query}`,'--jq',filter]) === String(iid);
      } else {
        const query = `{project(fullPath:${JSON.stringify(t.project)}) {id fullPath workItems(iids:["${iid}"],first:1) {nodes {iid state workItemType {name} widgets {__typename ... on WorkItemWidgetHierarchy {children(first:100) {pageInfo {hasNextPage} nodes {workItemType {name}}}}}}}}}`;
        const data = JSON.parse(run('glab', ['api','graphql','--hostname',t.gitlabHost!, '-f',`query=${query}`]));
        const project = data.data?.project, nodes = project?.workItems?.nodes, item = nodes?.[0];
        const children = item?.widgets?.find((w: any) => w.__typename === 'WorkItemWidgetHierarchy')?.children;
        runnable = !data.errors?.length && project?.fullPath === t.project && project?.id === `gid://gitlab/Project/${t.projectId}` && nodes?.length === 1 && item.iid === String(iid) && item.state === 'OPEN'
          && (item.workItemType?.name === 'Task' ? config.SUBTASKS.enabled : item.workItemType?.name === 'Issue' && (!config.SUBTASKS.enabled || (children?.pageInfo?.hasNextPage === false && children.nodes.every((c: any) => typeof c.workItemType?.name === 'string' && c.workItemType.name !== 'Task'))));
      }
    } catch { /* unavailable or malformed facts cannot authorize selection */ }
    if (!runnable) throw Error(`Ticket ${iid} is missing, not a runnable unit, or has unresolved repository/hierarchy facts`);
  }
}
