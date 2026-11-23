// Factory-owned tracker reads for selection explanation. No project modules or tracker mutations are loaded.
// Keep native queries and pagination in step with the execution adapters.
import { execFileSync, spawnSync } from 'node:child_process';
import type { EffectiveConfig } from './project-config.mts';
import { batchLinks } from './batch-links.mts';
import type { Child } from './graph.mts';
import type { Ticket, ReadyTicket, Select } from './tracker.mts';
export function nativeGithub(config: EffectiveConfig) {
  const { TRACKER, LABELS } = config;
  const REPO = TRACKER.project;
  const HOST = (TRACKER as { host?: string }).host ?? "github.com";
  const [OWNER, NAME] = REPO.split("/");

  function gh(args: string[]): string {
    return execFileSync("gh", args, { encoding: "utf8", timeout:20_000, killSignal: 'SIGKILL', env: { ...process.env, GH_HOST: HOST }, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).trim();
  }
  const json = <T,>(args: string[]): T => JSON.parse(gh(args));

  type GhIssue = { number: number; title: string; body: string; state: string; labels?: { name: string }[]; assignees?: { login: string }[]; author?: { login: string }; milestone?: { title: string } | null };
  const slim = (i: GhIssue): Ticket => ({ iid: i.number, title: i.title, description: i.body ?? "", state: i.state.toLowerCase(), labels: (i.labels ?? []).map((l) => l.name), assignees: i.assignees?.map(a => ({ username: a.login })), author: i.author ? { username: i.author.login } : undefined, milestone: i.milestone });
  const FIELDS = "number,title,body,state,labels,assignees,author,milestone";

  const currentUsername = () => json<{ login: string }>(['api', 'user']).login;

  /** GraphQL; a missing issue (NOT_FOUND, e.g. a PR number) comes back as null rather than an error. */
  function gql<T>(query: string): T {
    const res = spawnSync("gh", ["api", "graphql", "-f", `query=${query}`], { encoding: "utf8", killSignal: 'SIGKILL', env: { ...process.env, GH_HOST: HOST }, maxBuffer: 64 * 1024 * 1024 });
    let out: { data?: T; errors?: { type?: string; message: string }[] };
    try {
      out = JSON.parse(res.stdout);
    } catch {
      throw new Error(`GitHub GraphQL failed: ${(res.stderr || res.stdout).slice(0, 500)}`);
    }
    const errors = (out.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
    if (errors.length || !out.data) throw new Error(`GitHub GraphQL: ${errors.map((e) => e.message).join("; ") || res.stderr}`);
    return out.data;
  }
  /** One GraphQL query per 50 issues, each issue under an alias. */
  function issuesQuery<T>(iids: number[], fields: string): Map<number, T> {
    const out = new Map<number, T>();
    for (let i = 0; i < iids.length; i += 50) {
      const chunk = iids.slice(i, i + 50);
      const data = gql<{ repository: Record<string, T | null> }>(
        `{ repository(owner: ${JSON.stringify(OWNER)}, name: ${JSON.stringify(NAME)}) { ${chunk.map((n) => `i${n}: issue(number: ${n}) { ${fields} }`).join(" ")} } }`,
      );
      for (const n of chunk) {
        const v = data.repository[`i${n}`];
        if (v) out.set(n, v);
      }
    }
    return out;
  }

  type Hierarchy = { parent: { number: number } | null; subIssues: { nodes: { number: number; state: string }[] } };
  const HIERARCHY = "parent { number } subIssues(first: 100) { nodes { number state } }";

  /** Each issue's sub-issues, in order. Issues without any are left out. */
  function children(iids: number[]): Map<number, Child[]> {
    const map = new Map<number, Child[]>();
    for (const [n, h] of issuesQuery<Hierarchy>(iids, HIERARCHY)) {
      if (h.subIssues.nodes.length) map.set(n, h.subIssues.nodes.map((k) => ({ iid: k.number, open: k.state === "OPEN" })));
    }
    return map;
  }

  /** The issue a sub-issue belongs to; undefined for a top-level issue. */
  function parentOf(iid: number): number | undefined {
    return issuesQuery<Hierarchy>([iid], HIERARCHY).get(iid)?.parent?.number;
  }

  function ticket(iid: number, strict = false): Ticket {
    const issue=json<GhIssue>(["issue", "view", String(iid), "-R", REPO, "--json", FIELDS]);
    if(strict && (issue.number!==iid || !['OPEN','CLOSED'].includes(issue.state) || !Array.isArray(issue.labels) || !issue.labels.every(l=>typeof l?.name==='string'))) throw Error(`Member state or exclusion facts unavailable for #${iid}`);
    return slim(issue);
  }

  const ORDER: Record<string, string> = { created_at: "created", updated_at: "updated", popularity: "comments" };

  /** Open issues carrying every ready label and no exclude label, filtered by `select`.
   * Search returns at most 1000 results regardless of --limit. At that boundary completeness is unknown:
   * fail the read so refresh preserves last-good facts instead of marking omitted tickets deselected. */
  function readyList(select: Select = {}): ReadyTicket[] {
    const search = [
      ...LABELS.exclude.map((l) => `-label:${JSON.stringify(l)}`),
      `sort:${ORDER[select.order ?? ""] ?? "created"}-${select.sort === "desc" ? "desc" : "asc"}`,
      select.search ?? "",
    ].filter(Boolean).join(" ");
    const args = ["issue", "list", "-R", REPO, "--state", "open", "--json", FIELDS, "--search", search];
    for (const l of LABELS.ready) args.push("--label", l);
    if (TRACKER.milestone) args.push("--milestone", TRACKER.milestone);
    if (select.assignee) args.push("--assignee", select.assignee);
    if (select.author) args.push("--author", select.author);
    const issues = json<GhIssue[]>([...args, "--limit", "1000"]);
    if (issues.length >= 1000) {
      throw new Error("GitHub selection may be incomplete at the 1000-result search limit; narrow dispatch filters before retrying. Selection is unknown.");
    }
    return issues.map((i) => ({ ...slim(i), assignees: (i.assignees ?? []).map((a) => ({ username: a.login })) }));
  }

  function blockers(iid:number) {
    const api=(path:string)=>json<any>(['api',path,'--hostname',HOST]);
    const issue=api(`repos/${REPO}/issues/${iid}`);
    const total=issue.issue_dependencies_summary?.total_blocked_by;
    const ids=batchLinks(iid,{kind:'github',project:REPO,host:HOST},api);
    if(issue.number!==iid || !Number.isSafeInteger(total) || total!==new Set(ids).size) throw Error(`Incomplete blocker inventory for #${iid}; check tracker permissions and retry`);
    return ids;
  }
  const mergedInto = (branch:string,base:string) => {
    const rows=json<unknown>(['pr','list','-R',REPO,'--state','merged','--head',branch,'--base',base,'--limit','1','--json','number,state,isCrossRepository,headRefName,baseRefName']);
    if(!Array.isArray(rows)||rows.some(r=>!Number.isSafeInteger(r?.number) || typeof r.state!=='string' || typeof r.isCrossRepository!=='boolean' || typeof r.headRefName!=='string' || typeof r.baseRefName!=='string')) throw Error('Unknown merged PR state');
    return rows.some(r=>!r.isCrossRepository && r.state==='MERGED' && r.headRefName===branch && r.baseRefName===base);
  };
  return { ticket, blockers, mergedInto, readyList, currentUsername, parentOf, children };
}
