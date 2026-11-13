// Project settings shared by main.mts and dispatch.mts. Description declarations select implementation
// models via modelAliases (#126); tracker model labels are neither required nor created.
// Reference config for personal projects: GitHub issues and PRs, the Pi agent with Claude subscription
// models (the pi-claude-subscription provider), and PRs merged automatically once CI passes. `factory init`
// installs it into a project as .sandcastle/config.mts. The client / Affinity Bridge reference (GitLab,
// Claude Code, MRs a person merges) is config.mts. Lines tagged `// factory:<name>` are the values
// `factory init` fills in; keep each tag exactly once.

export const TRACKER = {
  kind: "github" as "gitlab" | "github", // picks tracker.github.mts
  host: "github.com",
  project: "owner/repo", // factory:project - the GitHub repo, as gh -R takes it
  // Milestone (title). The dispatcher only picks issues in it, and the ticket graph looks for
  // blockers among its open issues. undefined = every open issue in the repo.
  milestone: undefined as string | undefined, // factory:milestone
};

// The only two models this config uses (pi provider/id, from the pi-claude-subscription provider, which
// runs the Claude Code CLI on a Claude subscription). Every model below must be one of these; main.mts and
// dispatch.mts refuse to run otherwise.
const MODELS = {
  sonnet: "pi-claude-subscription/claude-sonnet-5-5",
  opus: "pi-claude-subscription/claude-opus-5-5",
};

// The Pi coding agent (https://pi.dev) runs the implementer and verifier in the container and the ticket
// analysis on the host, always through the pi-claude-subscription provider (a Pi extension that spawns
// `claude -p`). Host: `claude auth login` and the extension installed (see ADAPTING.md); analysis loads it
// with an explicit `-e`, so no other extension is enabled. Container: the image carries the extension and
// the Claude Code CLI (agent-pi layer), and the CLI logs in with CLAUDE_CODE_OAUTH_TOKEN from
// .sandcastle/.env (`claude setup-token`). There is no Pi login or API key for this provider.
export const AGENT = {
  provider: "pi" as "claude" | "pi",
  // A standalone **Model:** / **Pi model:** field selects an alias or an approved full ID.
  // Aliases ignore case. Missing, unsupported or conflicting fields keep the ticket queued.
  modelAliases: {
    "Sonnet 5.5": MODELS.sonnet,
    sonnet: MODELS.sonnet,
    "Opus 5.5": MODELS.opus,
    opus: MODELS.opus,
  } as Record<string, string>,
  model: MODELS.opus, // fixed: the verifier
  // Reasoning effort: "off" | "minimal" | "low" | "medium" | "high" | "xhigh".
  thinking: "high" as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined,
};

// After the verifier passes and the branch is pushed, Sandcastle opens a PR and merges it once every
// CI check on the pushed commit passes. This is a deterministic gate (ci.mts): failed checks, no
// checks, or checks still running at the deadline mean no merge. Failed CI drafts the PR; other
// blocked gates wait for a person. Required named checks must pass, not skip. CI must
// run on every PR (no `paths` filter), or PRs that touch no matching file will never merge.
export const MERGE = {
  auto: true,
  requiredChecks: [] as string[], // optional exact check/job names on either tracker
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

export const allLabels = () => [...new Set([...LABELS.ready, ...LABELS.exclude, LABELS.needsHuman, LABELS.done])];

// GitHub sub-issues.
export const SUBTASKS = {
  // true: a ready issue with sub-issues is a container, and each open sub-issue is a run of its own
  // (closed once its PR merges). false, or `--whole-issues`: every ready issue is one run.
  enabled: true,
};

// Ticket graph: dependency analysis and conflict holds (see graph.mts).
export const GRAPH = {
  model: MODELS.sonnet, // fixed: the read-only analysis on the host
  maxAnalysesPerPass: 5,
  analysisTimeoutMinutes: 10,
  // Paths whose overlap never holds a ticket back: exact file, or directory ending in "/".
  conflictIgnore: [] as string[],
  // Manifests of tickets that left the catalogue are deleted after this long.
  pruneAfterDays: 30,
};
