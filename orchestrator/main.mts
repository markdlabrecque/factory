import { createSandbox, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { setProject, setStage } from "./board.mts";

// End-to-end loop for one GitLab ticket (run from the repo root):
//   npx tsx .sandcastle/main.mts --base sal-develop [--issue 695] [--no-push]
// 1. branch <iid>-<slug> off origin/<base>   2. implementer run   3. verifier run (screenshots/video + verdict)
// 4. host posts the evidence to the ticket   5. on PASS: push, wait for CI, open an MR into <base>.
// Never merges, never closes the ticket. All GitLab calls run on the host with your glab auth;
// the container has no GitLab token.

// ---- Project config: the block to edit when adapting this to another project ----------
// (Also adapt sandbox/bootstrap-site.sh, the Environment section of prompt.md, and the fixture
// advice in prompt.verify.md. See ADAPTING.md.)
const CONFIG = {
  gitlabHost: "git.affinitybridge.com",
  project: "islandhealth/public-site", // path with namespace
  projectId: 699,
  labels: ["Ready to do", "ready-for-agent"], // an issue needs all of these to be picked automatically
  image: "sandcastle-islandhealth",
  model: "claude-opus-4-8",
  ciWaitMinutes: 30, // give up waiting for a branch pipeline after this long
  noPipelineMinutes: 2, // open the MR anyway if no branch pipeline appears in this time
  // Runs in order inside the container once it is up; the working directory is the worktree.
  sandboxSetup: [
    { command: "cd /home/agent/workspace && composer install --no-interaction --prefer-dist", timeoutMs: 20 * 60_000 },
    { command: "start-web.sh /home/agent/workspace/web", sudo: true },
    { command: "/opt/sandcastle/bootstrap-site.sh", timeoutMs: 10 * 60_000 },
  ],
};
const PROJECT = CONFIG.project;
const PROJECT_ID = CONFIG.projectId;
const HOST = CONFIG.gitlabHost;
const LABELS = CONFIG.labels;
const IMAGE = CONFIG.image;
const MODEL = CONFIG.model;

let currentIid: string | undefined;
let finished = false;
let lastMessage = "";
function fail(msg: string): never {
  lastMessage = msg;
  console.error(msg);
  process.exit(1);
}
// Anything that ends the process before a terminal stage lands on the board as "washed away".
process.on("exit", (code) => {
  if (currentIid && !finished) setStage(currentIid, { stage: "stopped", note: lastMessage || `exited with code ${code}` });
});
function sh(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}
const glab = (...args: string[]) => sh("glab", args);

const { values: opts } = parseArgs({
  options: {
    base: { type: "string" },
    issue: { type: "string" },
    "no-push": { type: "boolean", default: false },
  },
});
if (!opts.base) fail("--base <integration branch> is required (e.g. sal-develop, or sal-redesign for #565 children)");
const base = opts.base;

// ---- pick the ticket -------------------------------------------------------
let iid = opts.issue;
if (!iid) {
  const list = JSON.parse(
    glab("issue", "list", "-R", PROJECT, "--opened", ...LABELS.flatMap((l) => ["--label", l]), "--per-page", "100", "--output", "json"),
  );
  if (!list.length) fail(`No open issues labelled ${LABELS.join(" + ")}.`);
  iid = String(list[0].iid);
}
const issue = JSON.parse(glab("issue", "view", iid, "-R", PROJECT, "--output", "json"));
const ticket = glab("issue", "view", iid, "-R", PROJECT, "--comments");
const slug = String(issue.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "");
const branch = `${iid}-${slug}`;

sh("git", ["fetch", "origin", base]);
const baseSha = sh("git", ["rev-parse", `origin/${base}`]);
if (sh("git", ["branch", "--list", branch]) || sh("git", ["ls-remote", "--heads", "origin", branch])) {
  fail(`Branch ${branch} already exists locally or on origin; delete it or pick another ticket.`);
}
currentIid = iid;
setProject(PROJECT);
setStage(iid, {
  title: String(issue.title), ticketUrl: `https://${HOST}/${PROJECT}/-/issues/${iid}`, branch, base, stage: "setup", startedAt: new Date().toISOString(), note: "",
  evidenceDir: resolve(".sandcastle/evidence", iid),
});
// Heartbeat so the board can tell a long agent run from a dead process.
setInterval(() => { if (!finished) setStage(iid!, {}); }, 60_000).unref();
console.log(`#${iid} ${issue.title}\n  branch ${branch} from origin/${base} (${baseSha.slice(0, 8)})`);

// ---- sandbox: one container + one site install shared by both runs -------------
const evidenceHost = resolve(".sandcastle/evidence", iid);
const evidenceBox = `/home/agent/evidence/${iid}`;
mkdirSync(evidenceHost, { recursive: true });

const sandbox = await createSandbox({
  branch,
  baseBranch: `origin/${base}`,
  sandbox: docker({
    imageName: IMAGE,
    mounts: [
      { hostPath: resolve(".sandcastle/evidence"), sandboxPath: "/home/agent/evidence" },
      { hostPath: resolve(".sandcastle/sandbox"), sandboxPath: "/opt/sandcastle", readonly: true },
    ],
  }),
  hooks: {
    sandbox: {
      onSandboxReady: CONFIG.sandboxSetup,
    },
  },
});

const promptArgs = {
  ISSUE_IID: iid,
  ISSUE_TITLE: String(issue.title),
  TICKET: ticket,
  BASE_BRANCH: base,
  BASE_SHA: baseSha,
  BRANCH: branch,
  EVIDENCE_DIR: evidenceBox,
};

let tip = "";
try {
  // ---- 1. implementer ----------------------------------------------------------
  setStage(iid, { stage: "implementing" });
  const impl = await sandbox.run({
    agent: claudeCode(MODEL),
    promptFile: "./.sandcastle/prompt.md",
    promptArgs,
    maxIterations: 1,
    completionSignal: "<promise>COMPLETE</promise>",
    name: "implementer",
  });
  if (!impl.commits.length) {
    fail(`Implementer made no commit for #${iid} (no change needed, or blocked). See ${impl.logFilePath ?? "logs"}. Nothing pushed.`);
  }
  tip = (await sandbox.exec("git rev-parse HEAD")).stdout.trim();

  // ---- 2. verifier -------------------------------------------------------------
  setStage(iid, { stage: "verifying" });
  const ver = await sandbox.run({
    agent: claudeCode(MODEL),
    promptFile: "./.sandcastle/prompt.verify.md",
    promptArgs: { ...promptArgs, TIP_SHA: tip },
    maxIterations: 1,
    completionSignal: "<promise>COMPLETE</promise>",
    name: "verifier",
  });
  const after = (await sandbox.exec("git rev-parse HEAD")).stdout.trim();
  const dirty = (await sandbox.exec("git status --porcelain")).stdout.trim();
  if (ver.commits.length || after !== tip || dirty) {
    fail(`Verifier changed the branch (commits=${ver.commits.length}, head=${after.slice(0, 8)}, dirty=${!!dirty}). Not posting or pushing; inspect ${sandbox.worktreePath}.`);
  }
} finally {
  await sandbox.close();
}

// ---- 3. post evidence to the ticket (host-side) -----------------------------------
setStage(iid, { stage: "posting" });
const verdictFile = resolve(evidenceHost, "verdict.md");
if (!existsSync(verdictFile)) fail(`Verifier wrote no verdict.md in ${evidenceHost}. Nothing posted or pushed.`);
const verdictText = readFileSync(verdictFile, "utf8").trim();
const verdict = /^VERDICT:\s*(PASS|FAIL|INCONCLUSIVE)/.exec(verdictText)?.[1] ?? "INCONCLUSIVE";

const upload = (file: string): string => {
  const out = JSON.parse(sh("glab", ["api", `projects/${PROJECT_ID}/uploads`, "--hostname", HOST, "--form", `file=@${file}`]));
  return String(out.markdown);
};
const files = readdirSync(evidenceHost).sort();
const media = (label: string) => files.filter((f) => (f.startsWith(`${label}-`) && f.endsWith(".png")) || f === `${label}.webm`);
const section = (label: string, title: string) => {
  const items = media(label).map((f) => `**${f}**\n\n${upload(resolve(evidenceHost, f))}`);
  return items.length ? `### ${title}\n\n${items.join("\n\n")}` : "";
};
const body = [
  `## Sandcastle verification: ${verdict}`,
  `Branch \`${branch}\` @ \`${tip.slice(0, 8)}\` (from \`${base}\` @ \`${baseSha.slice(0, 8)}\`). Synthetic data.`,
  verdictText.replace(/^VERDICT:.*\n?/, ""),
  section("before", "Before"),
  section("after", "After"),
].filter(Boolean).join("\n\n");
glab("issue", "note", iid, "-R", PROJECT, "-m", body);
console.log(`Evidence posted to #${iid} (verdict ${verdict}).`);
setStage(iid, { verdict });

if (verdict !== "PASS") fail(`Verdict ${verdict}: branch ${branch} kept locally, not pushed. Review the ticket comment.`);
if (opts["no-push"]) {
  finished = true;
  setStage(iid, { stage: "done", note: "--no-push: branch ready locally" });
  console.log(`--no-push: stopping. Branch ${branch} is ready locally.`);
  process.exit(0);
}

// ---- 4. push, wait for CI, open MR into the integration branch ----------------------
setStage(iid, { stage: "pushing" });
sh("git", ["push", "-u", "origin", branch]);
const sha = sh("git", ["rev-parse", branch]);

setStage(iid, { stage: "ci" });
let status = "none";
const deadline = Date.now() + CONFIG.ciWaitMinutes * 60_000;
const noPipelineBy = Date.now() + CONFIG.noPipelineMinutes * 60_000;
while (Date.now() < deadline) {
  const runs = JSON.parse(sh("glab", ["api", `projects/${PROJECT_ID}/pipelines?sha=${sha}&per_page=1`, "--hostname", HOST]));
  status = runs[0]?.status ?? "none";
  if (["success", "failed", "canceled", "skipped"].includes(status)) break;
  if (status === "none" && Date.now() > noPipelineBy) break;
  await new Promise((r) => setTimeout(r, 15_000));
}
if (status === "failed" || status === "canceled") fail(`CI ${status} on ${branch}. Pushed, but no MR opened.`);
if (!["success", "none", "skipped"].includes(status)) fail(`CI still ${status} after ${CONFIG.ciWaitMinutes} min on ${branch}. Pushed, no MR opened.`);

const description = [
  `Refs #${iid}`,
  `Implemented and verified by Sandcastle. Verdict: **${verdict}** (evidence in the ticket comment).`,
  status === "success" ? "Branch CI passed before this MR was opened." : "No branch pipeline appeared; CI will run on this MR.",
].join("\n\n");
const mrOut = glab(
    "mr", "create", "-R", PROJECT, "--source-branch", branch, "--target-branch", base,
    "--title", `#${iid}: ${issue.title}`, "--description", description, "--yes", "--no-editor",
);
console.log(mrOut);
finished = true;
setStage(iid, { stage: "done", mr: mrOut.split(/\s+/).find((w) => w.startsWith("http")) });
console.log("Not merged and ticket left open: merge and close by hand once you're happy.");
