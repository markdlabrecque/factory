// Factory-owned tracker reads for selection explanation. No project modules or tracker mutations are loaded.
// Keep native queries and pagination in step with the execution adapters.
import { execFileSync } from 'node:child_process';
import type { EffectiveConfig } from './project-config.mts';
import { gitlabBlockerIds } from './batch-links.mts';
import type { Child } from './graph.mts';
import type { Ticket, ReadyTicket, Select } from './tracker.mts';
export function nativeGitlab(config: EffectiveConfig) {
  const { TRACKER, LABELS } = config;
  const { gitlabHost: HOST = "", projectId: ID = 0 } = TRACKER as { gitlabHost?: string; projectId?: number };

  function glab(args: string[]): string {
    return execFileSync("glab", args, { encoding: "utf8", timeout:20_000, killSignal: 'SIGKILL', env: { ...process.env, GITLAB_HOST: HOST }, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).trim();
  }

  const currentUsername = () => JSON.parse(glab(['api', 'user', '--hostname', HOST])).username as string;
  const slim = (t: Ticket): Ticket => ({ iid: t.iid, title: t.title, description: t.description ?? '', state: t.state, labels: t.labels ?? [], assignees: t.assignees, author: t.author, milestone: t.milestone, issue_type: t.issue_type, confidential: t.confidential });
  const api = <T,>(path: string): T => JSON.parse(glab(["api", path, "--hostname", HOST]));
  function gql<T>(query: string): T {
    const out = JSON.parse(glab(["api", "graphql", "--hostname", HOST, "-f", `query=${query}`]));
    if (out.errors?.length) throw new Error(`GitLab GraphQL: ${out.errors.map((e: { message: string }) => e.message).join("; ")}`);
    return out.data;
  }
  type Hierarchy = { iid: string; workItemType: { name: string }; widgets: { parent?: { iid: string } | null; children?: { nodes: { iid: string; state: string; workItemType: { name: string } }[] } }[] };
  function hierarchy(iids: number[]): Hierarchy[] {
    const out: Hierarchy[] = [];
    for (let i = 0; i < iids.length; i += 50) {
      const list = iids.slice(i, i + 50).map((n) => JSON.stringify(String(n))).join(",");
      const data = gql<{ project: { workItems: { nodes: Hierarchy[] } } }>(
        `{ project(fullPath: ${JSON.stringify(TRACKER.project)}) { workItems(iids: [${list}], first: 50) { nodes { iid workItemType { name } widgets { ... on WorkItemWidgetHierarchy { parent { iid } children(first: 100) { nodes { iid state workItemType { name } } } } } } } } }`,
      );
      out.push(...data.project.workItems.nodes);
    }
    return out;
  }

  /** Each issue's Tasks, in board order. Issues without Tasks are left out. */
  function children(iids: number[]): Map<number, Child[]> {
    const map = new Map<number, Child[]>();
    for (const w of hierarchy(iids)) {
      const kids = w.widgets.flatMap((x) => x.children?.nodes ?? []).filter((k) => k.workItemType.name === "Task");
      if (kids.length) map.set(Number(w.iid), kids.map((k) => ({ iid: Number(k.iid), open: k.state === "OPEN" })));
    }
    return map;
  }

  /** The issue a Task belongs to; undefined for anything that isn't a Task with a parent. */
  function parentOf(iid: number): number | undefined {
    const w = hierarchy([iid])[0];
    if (w?.workItemType.name !== "Task") return undefined;
    const p = w.widgets.find((x) => x.parent)?.parent;
    return p ? Number(p.iid) : undefined;
  }

  function ticket(iid: number, strict = false): Ticket {
    const t = api<Ticket & {project_id:number}>(`projects/${ID}/issues/${iid}`);
    if(strict && (t.iid!==iid || t.project_id!==ID || !['opened','closed'].includes(t.state??'') || !Array.isArray(t.labels) || !t.labels.every(l=>typeof l==='string'))) throw Error(`Member identity, state or exclusion facts unavailable for #${iid}`);
    return slim(t);
  }

  /** Open tickets carrying every ready label and no exclude label, filtered by `select`. Reads every page, so a
   * ticket past the first 100 is not mistaken for deselected and hidden from the board (#135). */
  function readyList(select: Select = {}): ReadyTicket[] {
    const args = ["issue", "list", "-R", TRACKER.project, "--per-page", "100", "--output", "json"];
    if (select.order) args.push("--order", select.order);
    if (select.sort) args.push("--sort", select.sort);
    if (LABELS.ready.length) args.push("--label", LABELS.ready.join(","));
    if (LABELS.exclude.length) args.push("--not-label", LABELS.exclude.join(","));
    if (TRACKER.milestone) args.push("--milestone", TRACKER.milestone);
    if (select.assignee) args.push("--assignee", select.assignee);
    if (select.author) args.push("--author", select.author);
    if (select.issueType) args.push("--issue-type", select.issueType);
    if (select.confidential === true) args.push('--confidential');
    if (select.search) args.push("--search", select.search);
    const all: ReadyTicket[] = [];
    for (let page = 1; ; page++) {
      const batch = JSON.parse(glab([...args, "--page", String(page)]) || "[]") as (ReadyTicket & { confidential?: boolean })[];
      // glab's boolean flag cannot express non-confidential-only reliably. Filter reliable API facts
      // after reading every page; missing facts fail closed rather than silently broaden eligibility.
      if (select.confidential === false && batch.some(t => typeof t.confidential !== 'boolean')) throw new Error('GitLab confidentiality facts missing; selection is unknown');
      all.push(...(select.confidential === false ? batch.filter(t => t.confidential === false) : batch));
      if (batch.length < 100) return all;
    }
  }

  function blockers(iid:number,members:readonly number[]) {
    // GET /links returns related_issues(current_user), not an unfiltered census. The
    // EE GraphQL widget aggregates open incoming links without that user's visibility filter.
    let links:unknown, count:unknown;
    try {
      links=api<unknown>(`projects/${ID}/issues/${iid}/links`);
      const {project}=gql<{project:{id:string; workItems:{nodes:{iid:string;widgets:{__typename:string;blockedByCount?:number}[]}[]}}}>(
        `{project(fullPath:${JSON.stringify(TRACKER.project)}) {id workItems(iids:["${iid}"],first:1) {nodes {iid widgets {__typename ... on WorkItemWidgetLinkedItems {blockedByCount}}}}}}`);
      const nodes=project.workItems.nodes;
      if(project.id===`gid://gitlab/Project/${ID}` && nodes.length===1 && nodes[0].iid===String(iid)) {
        const widgets=nodes[0].widgets.filter(w=>w.__typename==='WorkItemWidgetLinkedItems');
        if(widgets.length===1) count=widgets[0].blockedByCount;
      }
    } catch { /* Unsupported schema, missing item or denied read: never substitute zero. */ }
    const ids=gitlabBlockerIds(links,ID,count);
    // The aggregate cannot detect a concealed CLOSED submitted prerequisite. For same-project
    // issues /links applies issue readability: independently establish visibility of the named
    // members not in the result before treating their absence as no edge. Never list other tickets.
    for(const member of members) if(member!==iid && !ids.includes(member)) {
      try { ticket(member,true); }
      catch { throw Error(`Unverifiable GitLab blocker inventory: restore read access to submitted #${member} and retry`); }
    }
    return ids;
  }
  const mergedInto = (branch:string,base:string) => {
    const rows=api<unknown>(`projects/${ID}/merge_requests?state=merged&source_branch=${encodeURIComponent(branch)}&target_branch=${encodeURIComponent(base)}&per_page=1`);
    if(!Array.isArray(rows)||rows.some(r=>!Number.isSafeInteger(r?.iid) || !Number.isSafeInteger(r.source_project_id) || !Number.isSafeInteger(r.target_project_id) || typeof r.source_branch!=='string' || typeof r.target_branch!=='string' || typeof r.state!=='string')) throw Error('Unknown merged MR state');
    return rows.some(r=>r.state==='merged' && r.source_project_id===ID && r.target_project_id===ID && r.source_branch===branch && r.target_branch===base);
  };
  return { ticket, blockers, mergedInto, readyList, currentUsername, parentOf, children };
}
