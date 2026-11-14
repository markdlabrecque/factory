// #137: confidential=false filters reliable facts over all pages and fails closed if facts are missing.
// #135: GitLab readyList reads every page; GitHub rejects capped search results rather than publish false
// deselection. Recording gh/glab stubs model Search's hard 1000-result cap and later-page failures.
// All calls stay on fixture-owned PATH boundaries; no tracker is contacted.
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
if (tool === "gh") n = Math.min(opt("--limit") ?? 30, 1000);
else {
  n = opt("--per-page") ?? 20; from = ((opt("--page") ?? 1) - 1) * n;
  if (process.env.READY_FAIL_PAGE === String(opt("--page"))) process.exit(9);
}
const ids = Array.from({ length: Math.max(0, Math.min(n, total - from)) }, (_, k) => from + k + 1);
console.log(JSON.stringify(ids.map((i) => tool === "gh"
  ? { number: i, title: "t" + i, body: "", state: "OPEN", labels: [], assignees: [] }
  : { iid: i, title: "t" + i, description: "", state: "opened", labels: [], ...(process.env.NO_CONFIDENTIAL_FACTS ? {} : {confidential: i % 2 === 0}) })));
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

test("GitHub: capped search results fail safely instead of implying deselection", () => {
  for (const total of [1000, 1001, 2500]) {
    reset(total);
    assert.throws(() => github.readyList({}), /Selection is unknown/);
    assert.equal(calls("gh").length, 1, "a larger --limit cannot bypass Search's cap");
  }
  reset(999);
  assert.equal(github.readyList({}).length, 999);
  assert.equal(calls("gh").length, 1);
});

test('GitLab: false confidentiality is not unrestricted and missing facts are unknown', () => {
  reset(250);
  const all = gitlab.readyList({confidential:false});
  assert.equal(all.length,125);
  assert.ok(all.every(t=>t.iid % 2 === 1));
  assert.equal(calls('glab').length,3);
  process.env.NO_CONFIDENTIAL_FACTS = '1';
  try { assert.throws(()=>gitlab.readyList({confidential:false}),/selection is unknown/); }
  finally { delete process.env.NO_CONFIDENTIAL_FACTS; }
});

test("GitLab: a later-page failure never returns partial selection facts", () => {
  reset(250);
  process.env.READY_FAIL_PAGE = "2";
  try {
    assert.throws(() => gitlab.readyList({}));
    assert.equal(calls("glab").length, 2);
  } finally {
    delete process.env.READY_FAIL_PAGE;
  }
});
