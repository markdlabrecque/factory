// Resolve only explicitly submitted IDs against the configured repository. Never discover by label or expand parents.
import { spawnSync } from 'node:child_process';
import type { EffectiveConfig } from '../../orchestrator/project-config.mts';

export function batchMembers(ids: string[]): number[] {
  if (!ids.length || ids.some(s => !/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) || new Set(ids).size !== ids.length)
    throw Error('Expected distinct positive project-local ticket numbers');
  return ids.map(Number);
}

type Lookup = 'runnable' | 'invalid' | 'unavailable';
function member(config: EffectiveConfig, iid: number): Lookup {
  const t = config.TRACKER;
  const [owner, name] = t.project.split('/').map(s => JSON.stringify(s));
  const github = t.kind === 'github';
  const query = github
    ? `{repository(owner:${owner},name:${name}) {nameWithOwner issue(number:${iid}) {number state subIssues(first:1) {totalCount}}}}`
    : `{project(fullPath:${JSON.stringify(t.project)}) {id fullPath workItems(iids:["${iid}"],first:1) {nodes {iid state workItemType {name} widgets {__typename ... on WorkItemWidgetHierarchy {children(first:100) {pageInfo {hasNextPage} nodes {workItemType {name}}}}}}}}}`;
  const host = github ? t.host! : t.gitlabHost!;
  const result = spawnSync(github ? 'gh' : 'glab', ['api','graphql','--hostname',host,'-f',`query=${query}`],
    { encoding:'utf8',timeout:20000,killSignal:'SIGKILL',maxBuffer:1<<20,stdio:['ignore','pipe','pipe'] });
  if (result.error || result.signal) return 'unavailable';
  const body = JSON.parse(result.stdout);
  if (body.errors?.length || result.status !== 0) {
    // gh also exits nonzero for GraphQL NOT_FOUND. Only an issue-specific response is negative ticket evidence.
    if (github && body.data?.repository?.nameWithOwner === t.project && Array.isArray(body.errors) && body.errors.length &&
        body.errors.every((e:any) => e.type === 'NOT_FOUND' && JSON.stringify(e.path) === '["repository","issue"]')) return 'invalid';
    return 'unavailable';
  }
  if (github) {
    const repo = body.data?.repository, issue = repo?.issue;
    if (typeof repo?.nameWithOwner !== 'string' || issue === undefined) return 'unavailable';
    if (repo.nameWithOwner !== t.project || issue === null) return 'invalid';
    if (!Number.isSafeInteger(issue.number) || !['OPEN','CLOSED'].includes(issue.state)) return 'unavailable';
    if (issue.number !== iid || issue.state !== 'OPEN') return 'invalid';
    if (!config.SUBTASKS.enabled) return 'runnable';
    const count = issue.subIssues?.totalCount;
    if (!Number.isSafeInteger(count) || count < 0) return 'unavailable';
    return count === 0 ? 'runnable' : 'invalid';
  }
  const project = body.data?.project, nodes = project?.workItems?.nodes;
  if (typeof project?.fullPath !== 'string' || typeof project.id !== 'string' || !Array.isArray(nodes)) return 'unavailable';
  if (project.fullPath !== t.project || project.id !== `gid://gitlab/Project/${t.projectId}` || nodes.length === 0) return 'invalid';
  const item = nodes[0];
  if (nodes.length !== 1 || typeof item?.iid !== 'string' || !['OPEN','CLOSED'].includes(item.state) || typeof item.workItemType?.name !== 'string') return 'unavailable';
  if (item.iid !== String(iid) || item.state !== 'OPEN') return 'invalid';
  if (item.workItemType.name === 'Task') return config.SUBTASKS.enabled ? 'runnable' : 'invalid';
  if (item.workItemType.name !== 'Issue') return 'invalid';
  if (!config.SUBTASKS.enabled) return 'runnable';
  const children = item.widgets?.find((w:any) => w.__typename === 'WorkItemWidgetHierarchy')?.children;
  if (!Array.isArray(children?.nodes) || !children.nodes.every((c:any) => typeof c?.workItemType?.name === 'string')) return 'unavailable';
  if (children.nodes.some((c:any) => c.workItemType.name === 'Task')) return 'invalid';
  return children.pageInfo?.hasNextPage === false ? 'runnable' : 'unavailable';
}

export function resolveMembers(config: EffectiveConfig, members: number[]): void {
  for (const iid of members) {
    let outcome: Lookup;
    try { outcome = member(config,iid); } catch { outcome = 'unavailable'; }
    if (outcome === 'unavailable') throw Error(`Tracker lookup unavailable for ticket ${iid}; check tracker access and retry`);
    if (outcome !== 'runnable') throw Error(`Ticket ${iid} is missing or not a runnable member of this project`);
  }
}
