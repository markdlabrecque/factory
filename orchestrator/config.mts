// Project settings shared by main.mts and dispatch.mts. Edit this file when adapting to a project.
// Reference config for client and Affinity Bridge work: GitLab, Claude Code, and MRs a person merges.
// For personal projects (GitHub, Pi with GPT models, PRs merged once CI passes) start from
// config.personal.mts instead, installed as config.mts.

export const TRACKER = {
  kind: "gitlab" as "gitlab" | "github", // picks tracker.gitlab.mts or tracker.github.mts
  gitlabHost: "git.affinitybridge.com",
  project: "islandhealth/public-site", // path with namespace
  projectId: 699,
  // Project-level milestone (title). The dispatcher only picks tickets in it, and the ticket graph
  // looks for blockers among its open tickets. undefined = every open ticket in the project.
  milestone: undefined as string | undefined,
};

// The coding agent for the implementer and verifier runs (in the container) and the ticket analysis
// (on the host, model in GRAPH.model). "claude": Claude Code, logged in with CLAUDE_CODE_OAUTH_TOKEN
// in .sandcastle/.env. "pi": the Pi agent, logged in with the host's pi login (see config.personal.mts).
export const AGENT = {
  provider: "claude" as "claude" | "pi",
  // Label -> model. Empty: the implementer uses `model`. Non-empty: every ticket must carry exactly one
  // of these labels, which picks the implementer's model (see config.personal.mts); `model` and
  // GRAPH.model must then be among these models too.
  modelLabels: {} as Record<string, string>,
  model: "claude-opus-4-8", // the verifier, and the implementer when modelLabels is empty
  // pi only: reasoning effort, "off" | "minimal" | "low" | "medium" | "high" | "xhigh".
  thinking: undefined as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined,
};

// What happens after the verifier passes and the branch is pushed.
export const MERGE = {
  // false: open the MR and stop; a person merges it. true (GitHub only): merge the PR once every CI
  // check on the pushed commit passes; no CI, or failed CI, means no merge.
  auto: false,
  method: "squash" as "merge" | "squash" | "rebase", // auto merges only
};

// Every label Sandcastle filters on or writes. main.mts and dispatch.mts check they all exist in the
// project at startup and offer to create any that are missing; declining quits the run.
export const LABELS = {
  // A ticket must carry ALL of these to be picked.
  ready: ["Ready to do", "ready-for-agent"],
  // A ticket carrying ANY of these is never picked.
  exclude: ["blocked", "needs-human", "wontfix"],
  // Added to a ticket when the implementer reports a blocker the graph can't resolve: one with no
  // providing ticket, or one that is already merged or closed. Keep it in `exclude`.
  needsHuman: "needs-human",
  // The stage a ticket moves to once its work is merged into the integration branch: a whole ticket
  // when its MR merges, a parent once every one of its Tasks is closed. The `ready` labels come off
  // and this one goes on; the ticket stays open.
  done: "Internal QA",
};

export const allLabels = () => [...new Set([...LABELS.ready, ...LABELS.exclude, LABELS.needsHuman, LABELS.done, ...Object.keys(AGENT.modelLabels)])];

// GitLab Tasks (the "Child items" on an issue).
export const SUBTASKS = {
  // true: a ready issue with Tasks is a container, and each open Task is a run of its own (closed
  // once its branch merges). false, or `--whole-issues` on dispatch.mts / main.mts: every ready issue
  // is one run, Tasks or not.
  enabled: true,
};

// Ticket graph: dependency analysis and conflict holds (see graph.mts).
export const GRAPH = {
  model: "sonnet", // model for the read-only analysis run on the host
  maxAnalysesPerPass: 5, // a new milestone fills in over a few dispatcher passes
  analysisTimeoutMinutes: 10,
  // Paths whose overlap never holds a ticket back: exact file, or directory ending in "/".
  conflictIgnore: [] as string[],
  // Manifests of tickets that left the catalogue are deleted after this long.
  pruneAfterDays: 30,
};
