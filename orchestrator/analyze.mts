import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyFor, stateDir } from "./board.mts";
import { GRAPH } from "./config.mts";
import { contentHash, isSandcastleNote } from "./graph.mts";
import type { Manifest, Note, Requirement } from "./graph.mts";
import type { Ticket } from "./tracker.mts";

// Ticket analysis: one read-only `claude -p` run on the host per ticket, against a detached worktree
// at origin/<base>. Read, Grep and Glob only: no Bash, no writes, no MCP servers, because ticket
// text is untrusted input.

const here = dirname(fileURLToPath(import.meta.url));
const git = (args: string[], cwd?: string) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

/** Detached worktree at origin/<base> (fetch first). Shared by every analysis in a pass. */
export function analysisWorktree(project: string, base: string): { path: string; sha: string } {
  const path = resolve(stateDir(), "worktrees", keyFor(base.replace(/[^A-Za-z0-9._-]+/g, "_"), project));
  const sha = git(["rev-parse", `origin/${base}`]);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    git(["worktree", "prune"]);
    git(["worktree", "add", "--detach", path, sha]);
  } else {
    git(["checkout", "--detach", "--force", sha], path);
    git(["clean", "-fdq"], path);
  }
  return { path, sha };
}

const SCHEMA = {
  type: "object",
  required: ["provides", "requires", "footprint"],
  properties: {
    provides: { type: "array", items: { type: "string" } },
    requires: {
      type: "array",
      items: {
        type: "object",
        required: ["what", "providedBy", "evidence", "confidence"],
        properties: {
          what: { type: "string" },
          providedBy: { type: ["integer", "null"] },
          evidence: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    footprint: { type: "array", items: { type: "string" } },
  },
};

const excerpt = (s: string, n = 300) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

/** Ticket text as an agent sees it: description, then comments from people. */
export function ticketText(t: Ticket, notes: Note[]): string {
  const comments = notes.filter((n) => !isSandcastleNote(n)).map((n) => `> ${n.body.replace(/\n/g, "\n> ")}`);
  return [t.description || "(no description)", ...(comments.length ? ["### Comments", ...comments] : [])].join("\n\n");
}

/** One line per open ticket plus what it provides when it has been analysed. */
export function catalogueText(cat: Ticket[], manifests: Map<number, Manifest>, self: number): string {
  const lines = cat.filter((t) => t.iid !== self).map((t) => {
    const provides = manifests.get(t.iid)?.provides ?? [];
    return [`- #${t.iid} ${t.title}`, t.description ? `  ${excerpt(t.description)}` : "", provides.length ? `  provides: ${provides.join("; ")}` : ""].filter(Boolean).join("\n");
  });
  return lines.length ? lines.join("\n") : "(none)";
}

export function analyse(args: {
  project: string;
  base: string;
  worktree: { path: string; sha: string };
  ticket: Ticket;
  notes: Note[];
  catalogue: Ticket[];
  manifests: Map<number, Manifest>;
  keepImplementerBlockers: boolean;
}): Manifest {
  const { ticket: t, catalogue: cat } = args;
  const vars: Record<string, string> = {
    ISSUE_IID: String(t.iid),
    ISSUE_TITLE: t.title,
    BASE_BRANCH: args.base,
    BASE_SHA: args.worktree.sha,
    CATALOGUE: catalogueText(cat, args.manifests, t.iid),
    TICKET: ticketText(t, args.notes),
  };
  // One pass, so placeholders inside ticket text are left alone.
  const prompt = readFileSync(resolve(here, "prompt.analyze.md"), "utf8").replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);

  const res = spawnSync(
    "claude",
    ["-p", "--model", GRAPH.model, "--tools", "Read,Grep,Glob", "--allowedTools", "Read,Grep,Glob", "--strict-mcp-config",
      "--no-session-persistence", "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA)],
    { cwd: args.worktree.path, input: prompt, encoding: "utf8", timeout: GRAPH.analysisTimeoutMinutes * 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`analysis of #${t.iid} failed (exit ${res.status ?? res.signal}): ${(res.stderr || res.stdout || "").slice(0, 500)}`);
  const out = JSON.parse(res.stdout);
  if (out.is_error || !out.structured_output) throw new Error(`analysis of #${t.iid} returned no result: ${String(out.result ?? "").slice(0, 500)}`);
  const so = out.structured_output as { provides: string[]; requires: Requirement[]; footprint: string[] };

  // Only open catalogue tickets can be providers; anything else the model names becomes unresolved.
  const open = new Map(cat.map((c) => [c.iid, c]));
  const requires = so.requires.map((r) => ({ ...r, providedBy: r.providedBy != null && r.providedBy !== t.iid && open.has(r.providedBy) ? r.providedBy : null }));
  const blockerHashes: Record<string, string> = {};
  for (const r of requires) {
    if (r.providedBy != null) {
      const p = open.get(r.providedBy)!;
      blockerHashes[r.providedBy] = contentHash({ title: p.title, description: p.description });
    }
  }
  const prev = args.manifests.get(t.iid);
  return {
    iid: t.iid,
    project: args.project,
    hash: contentHash({ title: t.title, description: t.description, notes: args.notes }),
    analyzedAt: new Date().toISOString(),
    base: args.base,
    baseSha: args.worktree.sha,
    provides: so.provides,
    requires,
    footprint: so.footprint,
    catalogueIids: cat.map((c) => c.iid),
    blockerHashes,
    ...(prev?.actualFootprint ? { actualFootprint: prev.actualFootprint } : {}),
    ...(args.keepImplementerBlockers && prev?.implementerBlockers ? { implementerBlockers: prev.implementerBlockers } : {}),
  };
}
