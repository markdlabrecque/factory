// Read authenticated repository identity and explicit work units. Identity-only checks never select or expand tickets.
import { spawnSync } from 'node:child_process';
import type { EffectiveConfig } from '../../orchestrator/project-config.mts';

export function batchMembers(ids: string[]): number[] {
  if (!ids.length || ids.some(s => !/^[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s))) || new Set(ids).size !== ids.length)
    throw Error('Expected distinct positive project-local ticket numbers');
  return ids.map(Number);
}

function queryRepository(config: EffectiveConfig, fields: string) {
  const t = config.TRACKER;
  const [owner, name] = t.project.split('/').map(s => JSON.stringify(s));
  const github = t.kind === 'github';
  const query = github
    ? `{viewer {id} repository(owner:${owner},name:${name}) {id nameWithOwner ${fields}}}`
    : `{currentUser {id} project(fullPath:${JSON.stringify(t.project)}) {id fullPath ${fields}}}`;
  const host = github ? t.host! : t.gitlabHost!;
  const result = spawnSync(github ? 'gh' : 'glab', ['api','graphql','--hostname',host,'-f',`query=${query}`],
    { encoding:'utf8',timeout:20000,killSignal:'SIGKILL',maxBuffer:1<<20,stdio:['ignore','pipe','pipe'] });
  if (result.error || result.signal) throw Error('Tracker transport unavailable');
  const body = JSON.parse(result.stdout), data = body.data;
  const actor = github ? data?.viewer?.id : data?.currentUser?.id;
  if (typeof actor !== 'string' || !actor.trim()) throw Error('Unauthenticated tracker response');
  return {body, ok:result.status === 0 && !body.errors?.length};
}

/** A repository's service-issued ID, not its reusable path. GitLab also has an independently configured numeric ID. */
export function trackerRepositoryId(config: EffectiveConfig): string {
  const t = config.TRACKER;
  try {
    const {body,ok} = queryRepository(config,'');
    const github = t.kind === 'github', repo = github ? body.data.repository : body.data.project;
    if (ok && (github ? repo?.nameWithOwner : repo?.fullPath) === t.project && typeof repo.id === 'string' &&
        (github ? /^[A-Za-z0-9_+/=-]{1,256}$/.test(repo.id) : repo.id === `gid://gitlab/Project/${t.projectId}`)) return repo.id;
  } catch { /* Never expose transport output or use the configured name as a fallback. */ }
  throw Error('Tracker lookup unavailable: authenticated repository identity missing or mismatched');
}

type Lookup = 'runnable' | 'invalid' | 'unavailable';
function member(config: EffectiveConfig, iid: number, repositoryId:string): Lookup {
  const t = config.TRACKER, github = t.kind === 'github';
  const fields = github ? `issue(number:${iid}) {number state subIssues(first:1) {totalCount}}`
    : `workItems(iids:["${iid}"],first:1) {nodes {iid state workItemType {name} widgets {__typename ... on WorkItemWidgetHierarchy {children(first:100) {pageInfo {hasNextPage} nodes {workItemType {name}}}}}}}`;
  return classifyBatchMember({github,project:t.project,subtasks:config.SUBTASKS.enabled},iid,repositoryId,queryRepository(config,fields));
}

/** Pure classification of one authenticated query; transport failures stay unavailable. */
export function classifyBatchMember(policy:{github:boolean;project:string;subtasks:boolean}, iid:number, repositoryId:string, {body,ok}:ReturnType<typeof queryRepository>):Lookup {
  const {github, project:expectedProject, subtasks} = policy;
  if (!ok) {
    // gh also exits nonzero for GraphQL NOT_FOUND. Only an issue-specific response is negative ticket evidence.
    if (github && body.data?.repository?.id === repositoryId && body.data.repository.nameWithOwner === expectedProject && Array.isArray(body.errors) && body.errors.length &&
        body.errors.every((e:any) => e.type === 'NOT_FOUND' && JSON.stringify(e.path) === '["repository","issue"]')) return 'invalid';
    return 'unavailable';
  }
  if (github) {
    const repo = body.data?.repository, issue = repo?.issue;
    if (typeof repo?.nameWithOwner !== 'string' || issue === undefined) return 'unavailable';
    if (repo.id !== repositoryId) return 'unavailable';
    if (repo.nameWithOwner !== expectedProject || issue === null) return 'invalid';
    if (!Number.isSafeInteger(issue.number) || !['OPEN','CLOSED'].includes(issue.state)) return 'unavailable';
    if (issue.number !== iid || issue.state !== 'OPEN') return 'invalid';
    if (!subtasks) return 'runnable';
    const count = issue.subIssues?.totalCount;
    if (!Number.isSafeInteger(count) || count < 0) return 'unavailable';
    return count === 0 ? 'runnable' : 'invalid';
  }
  const project = body.data?.project, nodes = project?.workItems?.nodes;
  if (typeof project?.fullPath !== 'string' || typeof project.id !== 'string' || !Array.isArray(nodes)) return 'unavailable';
  if (project.fullPath !== expectedProject || project.id !== repositoryId || nodes.length === 0) return 'invalid';
  const item = nodes[0];
  if (nodes.length !== 1 || typeof item?.iid !== 'string' || !['OPEN','CLOSED'].includes(item.state) || typeof item.workItemType?.name !== 'string') return 'unavailable';
  if (item.iid !== String(iid) || item.state !== 'OPEN') return 'invalid';
  if (item.workItemType.name === 'Task') return subtasks ? 'runnable' : 'invalid';
  if (item.workItemType.name !== 'Issue') return 'invalid';
  if (!subtasks) return 'runnable';
  const children = item.widgets?.find((w:any) => w.__typename === 'WorkItemWidgetHierarchy')?.children;
  if (!Array.isArray(children?.nodes) || !children.nodes.every((c:any) => typeof c?.workItemType?.name === 'string')) return 'unavailable';
  if (children.nodes.some((c:any) => c.workItemType.name === 'Task')) return 'invalid';
  return children.pageInfo?.hasNextPage === false ? 'runnable' : 'unavailable';
}

export function resolveMembers(config: EffectiveConfig, members: number[], repositoryId:string): void {
  for (const iid of members) {
    let outcome: Lookup;
    try { outcome = member(config,iid,repositoryId); } catch { outcome = 'unavailable'; }
    if (outcome === 'unavailable') throw Error(`Tracker lookup unavailable for ticket ${iid}; check tracker access and retry`);
    if (outcome !== 'runnable') throw Error(`Ticket ${iid} is missing or not a runnable member of this project`);
  }
}
