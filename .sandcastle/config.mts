// Project settings shared by main.mts and dispatch.mts. Edit this file when adapting to a project.
// Reference config for personal projects: GitHub issues and PRs, the Pi agent with Claude subscription
// models (the pi-claude-subscription provider), and PRs merged automatically once CI passes. `factory init`
// installs it into a project as .sandcastle/config.mts. The client / Affinity Bridge reference (GitLab,
// Claude Code, MRs a person merges) is config.mts. Lines tagged `// factory:<name>` are the values
// `factory init` fills in; keep each tag exactly once.

export const TRACKER = {
  kind: "github" as "gitlab" | "github", // picks tracker.github.mts
  host: "github.com",
  project: "markdlabrecque/factory", // factory:project - the GitHub repo, as gh -R takes it
  // Milestone (title). The dispatcher only picks issues in it, and the ticket graph looks for
  // blockers among its open issues. undefined = every open issue in the repo.
  milestone: undefined as string | undefined, // factory:milestone
};

// Local edit (Factory dogfooding): GitHub tracker with the Claude Code agent. Claude Code runs the implementer
// and verifier in the container and the ticket analysis on the host. Host: `claude auth login`. Container: the
// CLI logs in with CLAUDE_CODE_OAUTH_TOKEN from .sandcastle/.env (`claude setup-token`). No Pi, no model labels.
export const AGENT = {
  provider: "claude" as "claude" | "pi",
  // Empty: one fixed model, AGENT.model, for every ticket. Put label -> model pairs here to choose per ticket.
  modelLabels: {} as Record<string, string>,
  model: "claude-opus-5-5", // the verifier, and the implementer when modelLabels is empty
  thinking: undefined as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined,
};

// After the verifier passes and the branch is pushed, Sandcastle opens a PR and merges it once every
// CI check on the pushed commit passes. This is a deterministic gate (ci.mts): failed checks, no
// checks, or checks still running at the deadline mean no merge, and the PR is left as a draft. CI must
// run on every PR (no `paths` filter), or PRs that touch no matching file will never merge.
export const MERGE = {
  auto: true,
  method: "squash" as "merge" | "squash" | "rebase",
};

// Every label Sandcastle filters on or writes. main.mts and dispatch.mts check they all exist in the
// repo at startup and offer to create any that are missing; declining quits the run.
export const LABELS = {
  // An issue must carry ALL of these to be picked.
  ready: ["ready-for-agent"],
  // An issue carrying ANY of these is never picked.
  exclude: ["blocked", "needs-human", "wontfix"],
  // Added when the implementer reports a blocker the graph can't resolve. Keep it in `exclude`.
  needsHuman: "needs-human",
  // Set once the work is merged: on a whole issue when its PR merges, on a parent once every one of
  // its sub-issues is closed. The `ready` labels come off; the issue stays open for you to close.
  done: "merged",
};

export const allLabels = () => [...new Set([...LABELS.ready, ...LABELS.exclude, LABELS.needsHuman, LABELS.done, ...Object.keys(AGENT.modelLabels)])];

// GitHub sub-issues.
export const SUBTASKS = {
  // true: a ready issue with sub-issues is a container, and each open sub-issue is a run of its own
  // (closed once its PR merges). false, or `--whole-issues`: every ready issue is one run.
  enabled: true,
};

// Ticket graph: dependency analysis and conflict holds (see graph.mts).
export const GRAPH = {
  model: "sonnet", // model for the read-only analysis run on the host
  maxAnalysesPerPass: 5,
  analysisTimeoutMinutes: 10,
  // Paths whose overlap never holds a ticket back: exact file, or directory ending in "/".
  conflictIgnore: [] as string[],
  // Manifests of tickets that left the catalogue are deleted after this long.
  pruneAfterDays: 30,
};
