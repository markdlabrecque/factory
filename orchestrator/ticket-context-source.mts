// Import-safe GitHub/GitLab structured context adapters. Each request is bounded by the collector.
// Read only the selected child, its immediate hierarchy parent and ordered comment pages; never follow URLs.
import { execFileSync } from 'node:child_process';
import { ContextReadError } from './ticket-context.mts';
import type { ContextIdentity, ContextNote, ContextRead, ContextTicket, ReadBudget, TicketContextSource } from './ticket-context.mts';
export interface ContextRequest { args: string[] }
export type ContextTransport = (request: ContextRequest, budget: ReadBudget) => string;
/** Shared bounded command transport for selected-runtime adapters and host-owned pre-charge checks. */
export function commandContextSource(identity: ContextIdentity, gitlabProjectId?: number, env: NodeJS.ProcessEnv = process.env): TicketContextSource {
  const github = identity.kind === 'github';
  return structuredContextSource(identity, ({ args }, budget) => {
    try {
      return execFileSync(github ? 'gh' : 'glab', github ? args : [...args, '--hostname', identity.host], {
        encoding: 'utf8', timeout: budget.timeoutMs, maxBuffer: budget.maxBytes, killSignal: 'SIGKILL',
        env: { ...env, ...(github ? { GH_HOST: identity.host } : { GITLAB_HOST: identity.host }) }, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new ContextReadError(code === 'ETIMEDOUT' ? 'timeout' : code === 'ENOBUFS' ? 'byte-limit' : 'read-failed');
    }
  }, gitlabProjectId);
}
const PAGE_SIZE = 100;
function record(v: unknown): Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ContextReadError('malformed');
  return v as Record<string, any>;
}
function text(v: unknown): string { if (typeof v !== 'string') throw new ContextReadError('malformed'); return v; }
function number(v: unknown): number { if (!Number.isSafeInteger(v) || (v as number) <= 0) throw new ContextReadError('malformed'); return v as number; }
function body(v: unknown): string { return v === null ? '' : text(v); }
function list(v: unknown): any[] { if (!Array.isArray(v)) throw new ContextReadError('malformed'); return v; }
export function structuredContextSource(identity: ContextIdentity, transport: ContextTransport, gitlabProjectId?: number): TicketContextSource {
  const github = identity.kind === 'github';
  const base = github ? `repos/${identity.project}/issues` : `projects/${gitlabProjectId}/issues`;
  const url = (iid: number) => `https://${identity.host}/${identity.project}/${github ? '' : '-/'}issues/${iid}`;
  function request(args: string[], budget: ReadBudget): ContextRead<any> {
    if (!github) number(gitlabProjectId);
    const raw = transport({ args }, budget), bytes = Buffer.byteLength(raw, 'utf8');
    if (bytes > budget.maxBytes) throw new ContextReadError('byte-limit');
    let value: any;
    try { value = JSON.parse(raw); } catch { throw new ContextReadError('malformed'); }
    return { value, bytes };
  }
  function graphql(query: string, budget: ReadBudget): ContextRead<any> {
    const read = request(['api', 'graphql', '-f', `query=${query}`], budget), out = record(read.value);
    if (out.errors !== undefined && (!Array.isArray(out.errors) || out.errors.length)) throw new ContextReadError('read-failed');
    return { value: record(out.data), bytes: read.bytes };
  }
  return {
    identity: { ...identity },
    ticket(iid, budget): ContextRead<ContextTicket> {
      number(iid);
      const read = request(['api', `${base}/${iid}`], budget), t = record(read.value);
      const actual = number(github ? t.number : t.iid);
      if (actual !== iid) throw new ContextReadError('malformed');
      return { bytes: read.bytes, value: { iid: actual, title: text(t.title), description: body(github ? t.body : t.description), url: url(iid) } };
    },
    notes(iid, page, budget) {
      number(iid); number(page);
      const endpoint = github ? `${base}/${iid}/comments?per_page=${PAGE_SIZE}&page=${page}`
        : `${base}/${iid}/notes?sort=asc&order_by=created_at&per_page=${PAGE_SIZE}&page=${page}`;
      const read = request(['api', endpoint], budget), rows = list(read.value);
      if (rows.length > PAGE_SIZE) throw new ContextReadError('malformed');
      const notes: ContextNote[] = rows.map(row => {
        const n = record(row), author = record(github ? n.user : n.author);
        if (!github && typeof n.system !== 'boolean') throw new ContextReadError('malformed');
        const id = String(number(n.id));
        return { id, body: text(n.body), system: github ? false : n.system, author: text(github ? author.login : author.username),
          createdAt: text(n.created_at), updatedAt: text(n.updated_at), url: `${url(iid)}${github ? '#issuecomment-' : '#note_'}${id}` };
      });
      // A full page cannot prove completion. Read the next numbered page, even when the total is an exact multiple.
      return { bytes: read.bytes, value: { notes, nextPage: rows.length === PAGE_SIZE ? page + 1 : null } };
    },
    parentOf(iid, budget) {
      number(iid);
      if (github) {
        const [owner, name] = identity.project.split('/');
        const read = graphql(`{ repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issue(number: ${iid}) { parent { number } } } }`, budget);
        const issue = record(record(read.value.repository).issue);
        if (!Object.hasOwn(issue, 'parent')) throw new ContextReadError('malformed');
        return { bytes: read.bytes, value: issue.parent === null ? null : number(record(issue.parent).number) };
      }
      const read = graphql(`{ project(fullPath: ${JSON.stringify(identity.project)}) { workItems(iids: [${JSON.stringify(String(iid))}], first: 1) { nodes { iid workItemType { name } widgets { ... on WorkItemWidgetHierarchy { parent { iid } } } } } } }`, budget);
      const nodes = list(record(record(read.value.project).workItems).nodes);
      if (nodes.length !== 1) throw new ContextReadError('malformed');
      const item = record(nodes[0]);
      if (text(item.iid) !== String(iid)) throw new ContextReadError('malformed');
      if (text(record(item.workItemType).name) !== 'Task') return { bytes: read.bytes, value: null };
      const hierarchy = list(item.widgets).map(record).filter(w => Object.hasOwn(w, 'parent'));
      if (hierarchy.length !== 1) throw new ContextReadError('malformed');
      const parent = hierarchy[0].parent;
      const parentIid = parent === null ? null : Number(text(record(parent).iid));
      return { bytes: read.bytes, value: parentIid === null ? null : number(parentIid) };
    },
  };
}
