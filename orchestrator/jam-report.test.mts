// The real scaffolded dispatcher's jam report (#61): a scheduled pass (FACTORY_JAM_REPORT and FACTORY_PASS_ID set) over a
// project whose only ready ticket has a stopped run writes a report naming that ticket as jammed, with its requirement
// fingerprint and labels minus Sandcastle's own, and launches nothing. A pass without FACTORY_JAM_REPORT writes nothing.
// The scaffold is built by cli/src/scaffold.mts; `gh` is the entrypoint fixture (orchestrator/fixtures/entrypoint), Git
// is real with a local bare origin. No tracker, agent or Docker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claimRun } from "../board/board.mts";
import { buildAssets } from "../cli/src/scaffold.mts";

const FIXTURES = join(import.meta.dirname, "fixtures/entrypoint");

test("a scheduled pass reports a still-ready stopped ticket as jammed; a manual one writes no report", (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "factory-jam-report-")));
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
    patch: { stage: "stopped", note: "exited", starting: undefined, branch: "7-fix-login", base: "main" } });

  const report = join(home, "jam.json");
  const pass = (extra: Record<string, string>) => spawnSync(process.execPath, [".sandcastle/dispatch.mts", "--base", "main", "--max", "3"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SANDCASTLE_STATE_DIR: state, ...extra },
  });
  const manual = pass({});
  assert.equal(manual.status, 0, manual.stderr + manual.stdout);
  assert.equal(existsSync(report), false, "a manual pass writes no report");

  const scheduled = pass({ FACTORY_JAM_REPORT: report, FACTORY_PASS_ID: "pass-1" });
  assert.equal(scheduled.status, 0, scheduled.stderr + scheduled.stdout);
  assert.match(scheduled.stdout, /jam: #7/);
  const r = JSON.parse(readFileSync(report, "utf8"));
  assert.deepEqual([r.version, r.pass, r.project, r.tickets], [1, "pass-1", "owner/repo", [7]]);
  assert.match(r.reasons["7"], /stopped/);
  assert.deepEqual(r.observed.map((o: { iid: number; labels: string[] }) => [o.iid, o.labels]), [[7, ["model:sonnet"]]]);
  assert.match(r.observed[0].content, /^[0-9a-f]{16,}$/);
  assert.ok(!readFileSync(join(fake, "gh.jsonl"), "utf8").includes('"create"'), "nothing was launched or delivered");
});
