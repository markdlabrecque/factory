// Project settings shared by main.mts and dispatch.mts. Edit this file when adapting to a project.

export const TRACKER = {
  gitlabHost: "git.affinitybridge.com",
  project: "islandhealth/public-site", // path with namespace
  projectId: 699,
  // Project-level milestone (title). The dispatcher only picks tickets in it, and the ticket graph
  // looks for blockers among its open tickets. undefined = every open ticket in the project.
  milestone: undefined as string | undefined,
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
};

export const allLabels = () => [...new Set([...LABELS.ready, ...LABELS.exclude, LABELS.needsHuman])];

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
