// The real scaffolded dispatcher (#87): a stopped card whose branch has a PR merged outside Factory moves to done with
// the PR, its merge time and "merged outside Factory", keeps its verdict, launches nothing, and the still-open ticket
// moves to the done label. A pass that finds no merged PR leaves the card stopped. The scaffold is built by
// cli/src/scaffold.mts; `gh` is the entrypoint fixture (orchestrator/fixtures/entrypoint, FAKE_MERGED_PR), Git is real
// with a local bare origin. No tracker, agent or Docker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claimRun, readRuns } from "../board/board.mts";
import { buildAssets } from "../cli/src/scaffold.mts";

const FIXTURES = join(import.meta.dirname, "fixtures/entrypoint");

test("a pass moves a stopped card whose work merged outside Factory to done, keeping its verdict", (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "factory-merged-outside-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const origin = join(home, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const root = join(home, "site");
  execFileSync("git", ["clone", "-q", origin, root], { stdio: "ignore" });
  git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  git(root, "push", "-q", "origin", "main");
  git(root, "branch", "7-fix-login");
  const state = join(home, "runs");
  for (const f of buildAssets({ profile: "personal", repo: "owner/repo", image: "img" }, state)) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content, { mode: f.mode });
  }
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nexec "${process.execPath}" "${join(FIXTURES, "gh.mjs")}" "$@"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const fake = join(home, "fake");
  mkdirSync(fake);
  claimRun({ dir: state, project: "owner/repo", iid: "7", pid: 2 ** 22 + 4321, cap: 99,
    patch: { stage: "stopped", note: "verifier said FAIL", verdict: "FAIL", starting: undefined, branch: "7-fix-login", base: "main" } });
  const pass = (extra: Record<string, string> = {}) => spawnSync(process.execPath, [".sandcastle/dispatch.mts", "--base", "main", "--max", "3"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SANDCASTLE_STATE_DIR: state, ...extra },
  });
  const card = () => readRuns(state).find((r) => r.iid === "7")!;

  const none = pass();
  assert.equal(none.status, 0, none.stderr + none.stdout);
  assert.equal(card().stage, "stopped", "no merged PR: the card stays stopped");

  const pr = { number: 12, title: "Fix the login form by hand", url: "https://github.com/owner/repo/pull/12", mergedAt: "2026-11-10T09:00:00Z" };
  const merged = pass({ FAKE_MERGED_PR: JSON.stringify(pr) });
  assert.equal(merged.status, 0, merged.stderr + merged.stdout);
  assert.match(merged.stdout, /#7 \(stopped\) merged into main outside Factory/);
  const r = card();
  assert.deepEqual([r.stage, r.verdict, r.mr, r.mergedAt, r.mergedOutside], ["done", "FAIL", pr.url, pr.mergedAt, { pr: 12, matchedBy: "branch" }]);
  const calls = readFileSync(join(fake, "gh.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).args as string[]);
  assert.ok(calls.some((a) => a.includes("--head") && a.includes("7-fix-login") && a.includes("merged")), "looked up by the recorded branch");
  assert.ok(calls.some((a) => a[0] === "api" && a[2] === "POST" && a[3].endsWith("/issues/7/labels")), "the open ticket moved to the done label");
  assert.ok(!calls.some((a) => a[1] === "create"), "nothing was launched or delivered");
});
