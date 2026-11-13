// Auto-merge adapter contract against recording CLI fixtures. No tracker/network access.
// Covers required gates, SHA guards, MR-first CI, manual delivery, and GitHub's failed-CI exception.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MERGE } from "./config.mts";

const dir = mkdtempSync(join(tmpdir(), "factory-delivery-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
for (const tool of ["gh", "glab"]) writeFileSync(join(dir, tool), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, "calls"))}, JSON.stringify(args)+'\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, "scenario"))}, 'utf8'));
const out = x => console.log(typeof x === 'string' ? x : JSON.stringify(x));
if (args[0] === 'pr') {
  if (args[1] === 'create') out('https://github.test/pull/1');
  else if (args[1] === 'checks') out(s.checks ?? [{name:'test',bucket:'pass'}]);
  else if (args[1] === 'merge' && s.refuse) process.exit(1);
  else if (!['merge','ready','comment'].includes(args[1])) process.exit(9);
} else if (args.includes('-X') && args.includes('POST') && args.some(x => x.endsWith('/merge_requests'))) {
  out({iid:1,web_url:'https://gitlab.test/merge_requests/1'});
} else if (args.some(x => x.endsWith('/merge_requests/1/merge'))) {
  if (s.refuse) process.exit(1);
  out({state:'merged'});
} else if (args.some(x => x.endsWith('/merge_requests/1/notes'))) {
  out({});
} else if (args.some(x => x.endsWith('/merge_requests/1'))) {
  out({sha:s.head ?? 'tip',head_pipeline:s.noPipeline ? null : {id:5,sha:s.pipelineSha ?? 'tip',status:s.status ?? 'success'}});
} else if (args.some(x => x.includes('/pipelines/5/jobs'))) {
  out(s.jobs ?? [{name:'test',status:'success'}]);
} else process.exit(9);
`, { mode: 0o755 });
process.env.PATH = `${dir}:${process.env.PATH}`;
const github = await import("./tracker.github.mts");
const gitlab = await import("./tracker.gitlab.mts");
const setup = (scenario = {}, required: string[] = []) => {
  writeFileSync(join(dir, "scenario"), JSON.stringify(scenario));
  writeFileSync(join(dir, "calls"), "");
  MERGE.requiredChecks = required;
};
const calls = () => readFileSync(join(dir, "calls"), "utf8").trim().split("\n").filter(Boolean).map((s) => JSON.parse(s) as string[]);
const delivery = { branch: "topic", base: "main", sha: "tip", title: "title", body: (s: string) => s, onStage: () => {}, waitMinutes: 1, noCiMinutes: 0, autoMerge: true };

// Advance the deadlines without a real 15-second sleep.
let now = 0;
Date.now = () => now += 10_000;
globalThis.setTimeout = ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout;

test("GitLab opens MR before reading CI and merges with the pushed SHA", async () => {
  setup({}, ["test"]);
  assert.equal((await gitlab.deliver(delivery)).merged, true);
  assert.ok(calls()[0].includes("POST"));
  assert.ok(calls().at(-1)?.includes("sha=tip"));
});

test("GitLab blocks missing, skipped, failed, manual, stale and absent CI", async () => {
  for (const scenario of [
    { jobs: [{ name: "other", status: "success" }] },
    { jobs: [{ name: "test", status: "skipped" }] },
    { jobs: [{ name: "test", status: "manual" }] },
    { status: "failed" }, { status: "running" }, { noPipeline: true },
    { pipelineSha: "old" }, { head: "changed" }, { refuse: true },
  ]) {
    setup(scenario, ["test"]);
    const result = await gitlab.deliver(delivery);
    assert.equal(result.merged, false);
    assert.ok(result.blocked);
    assert.ok(calls().some((c) => c.some((a) => a.endsWith("/notes"))));
    if (!("refuse" in scenario)) assert.ok(!calls().some((c) => c.some((a) => a.endsWith("/merge"))));
  }
});

test("GitHub uses required names and preserves SHA guard", async () => {
  setup({}, ["test"]);
  assert.equal((await github.deliver(delivery)).merged, true);
  assert.ok(calls().at(-1)?.includes("--match-head-commit"));
  assert.ok(calls().at(-1)?.includes("tip"));
});

test("GitHub parks missing/skipped/no checks but failed CI still drafts and throws", async () => {
  for (const checks of [[], [{ name: "other", bucket: "pass" }], [{ name: "test", bucket: "skipping" }]]) {
    setup({ checks }, ["test"]);
    assert.ok((await github.deliver(delivery)).blocked);
    assert.ok(!calls().some((c) => c.includes("merge") || c.includes("--undo")));
    assert.ok(calls().some((c) => c.includes("comment")));
  }
  setup({ checks: [{ name: "test", bucket: "fail" }] }, ["test"]);
  await assert.rejects(github.deliver(delivery), /CI failed/);
  assert.ok(calls().some((c) => c.includes("--undo")));
});

test("GitHub rejected SHA-guarded merge comments and parks, without drafting", async () => {
  setup({ refuse: true }, ["test"]);
  const result = await github.deliver(delivery);
  assert.equal(result.merged, false);
  assert.match(result.blocked ?? "", /SHA-guarded merge/);
  assert.equal(result.url, "https://github.test/pull/1");
  assert.ok(calls().some((c) => c.includes("comment")));
  assert.ok(!calls().some((c) => c.includes("--undo")));
});

test("GitHub manual delivery opens only, regardless of required checks", async () => {
  setup({}, ["missing"]);
  assert.deepEqual(await github.deliver({ ...delivery, autoMerge: false }), { url: "https://github.test/pull/1", merged: false });
  assert.equal(calls().length, 1);
});
