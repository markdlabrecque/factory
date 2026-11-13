// #135: readyList returns every ready ticket, not only the first page (GitLab) or the first `--limit` (GitHub);
// a ticket past such a limit would be judged "not selected" and hidden from the board. Recording gh/glab stubs on
// PATH serve a fixed count of tickets and honour --page/--per-page and --limit, so no tracker is contacted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "factory-ready-list-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const serve = join(dir, "serve.mjs");
writeFileSync(serve, `
const [tool, ...a] = process.argv.slice(2);
const total = Number(process.env.READY_TOTAL), opt = (f) => { const i = a.indexOf(f); return i < 0 ? undefined : Number(a[i + 1]); };
if (a[0] !== "issue" || a[1] !== "list") { console.error("unexpected: " + a.join(" ")); process.exit(9); }
let from = 0, n;
if (tool === "gh") n = opt("--limit") ?? 30;
else { n = opt("--per-page") ?? 20; from = ((opt("--page") ?? 1) - 1) * n; }
const ids = Array.from({ length: Math.max(0, Math.min(n, total - from)) }, (_, k) => from + k + 1);
console.log(JSON.stringify(ids.map((i) => tool === "gh"
  ? { number: i, title: "t" + i, body: "", state: "OPEN", labels: [], assignees: [] }
  : { iid: i, title: "t" + i, description: "", state: "opened", labels: [] })));
`);
for (const tool of ["gh", "glab"]) {
  writeFileSync(join(dir, tool), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dir}/${tool}.log"\nexec "${process.execPath}" "${serve}" ${tool} "$@"\n`, { mode: 0o755 });
}
process.env.PATH = `${dir}:${process.env.PATH}`;
const github = await import("./tracker.github.mts");
const gitlab = await import("./tracker.gitlab.mts");
const calls = (tool: string) => readFileSync(join(dir, `${tool}.log`), "utf8").trim().split("\n").filter(Boolean);
const reset = (total: number) => { process.env.READY_TOTAL = String(total); for (const t of ["gh", "glab"]) writeFileSync(join(dir, `${t}.log`), ""); };

test("GitLab: every page of ready tickets is read, stopping at the first short page", () => {
  reset(250);
  const all = gitlab.readyList({});
  assert.equal(all.length, 250);
  assert.equal(all.at(-1)?.iid, 250);
  assert.deepEqual(calls("glab").map((c) => c.match(/--page (\d+)/)?.[1]), ["1", "2", "3"]);
  reset(100);
  assert.equal(gitlab.readyList({}).length, 100);
  assert.equal(calls("glab").length, 2, "an exactly full page is followed by one empty page");
});

test("GitHub: a list that fills the limit is re-read with a larger one", () => {
  reset(2500);
  const all = github.readyList({});
  assert.equal(all.length, 2500);
  assert.equal(all.at(-1)?.iid, 2500);
  assert.deepEqual(calls("gh").map((c) => c.match(/--limit (\d+)/)?.[1]), ["1000", "2000", "4000"]);
  reset(3);
  assert.equal(github.readyList({}).length, 3);
  assert.equal(calls("gh").length, 1);
});
