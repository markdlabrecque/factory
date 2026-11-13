// #86: the tracker adapters' mergedPr lookup, against recording gh/glab stubs on PATH (no tracker is contacted).
// The run's branch wins; otherwise only a title starting with `#N:` counts (not `#860:` or a mention), newest first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "factory-merged-pr-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
// Answers by request shape; anything else fails so an unexpected call can't pass silently.
for (const tool of ["gh", "glab"]) {
  writeFileSync(join(dir, tool), `#!/bin/sh
printf '%s\\n' "$*" >> "${dir}/${tool}.log"
case "$*" in
  *--head*|*source_branch=*) cat "${dir}/${tool}.branch.json" ;;
  *--search*|*search=*) cat "${dir}/${tool}.title.json" ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
`, { mode: 0o755 });
}
process.env.PATH = `${dir}:${process.env.PATH}`;
const github = await import("./tracker.github.mts");
const gitlab = await import("./tracker.gitlab.mts");
const serve = (tool: string, branch: unknown[], title: unknown[]) => {
  writeFileSync(join(dir, `${tool}.branch.json`), JSON.stringify(branch));
  writeFileSync(join(dir, `${tool}.title.json`), JSON.stringify(title));
  writeFileSync(join(dir, `${tool}.log`), "");
};
const calls = (tool: string) => readFileSync(join(dir, `${tool}.log`), "utf8").trim().split("\n").filter(Boolean);
const pr = (number: number, title: string, mergedAt: string) => ({ number, title, url: `https://pr/${number}`, mergedAt });
const mr = (iid: number, title: string, merged_at: string) => ({ iid, title, web_url: `https://mr/${iid}`, merged_at });

test("GitHub: a merged PR from the run's branch is found first, newest merge wins", () => {
  serve("gh", [pr(1, "anything", "2026-11-01T00:00:00Z"), pr(2, "anything", "2026-11-03T00:00:00Z")], [pr(3, "#86: other", "2026-11-09T00:00:00Z")]);
  assert.deepEqual(github.mergedPr(86, "86-topic", "main"), { number: 2, title: "anything", url: "https://pr/2", mergedAt: "2026-11-03T00:00:00Z", matchedBy: "branch" });
  assert.equal(calls("gh").length, 1);
  assert.match(calls("gh")[0], /--state merged --base main --head 86-topic/);
});

test("GitHub: without a branch match, only a title starting with #N: counts", () => {
  serve("gh", [], [pr(4, "#860: near miss", "2026-11-09T00:00:00Z"), pr(5, "Fix for #86: mention", "2026-11-09T00:00:00Z"), pr(6, "#86: Real", "2026-11-02T00:00:00Z")]);
  assert.deepEqual(github.mergedPr(86, "86-topic", "main"), { number: 6, title: "#86: Real", url: "https://pr/6", mergedAt: "2026-11-02T00:00:00Z", matchedBy: "title" });
  assert.match(calls("gh")[1], /--state merged --base main --search 86 in:title/);
  serve("gh", [], [pr(4, "#860: near miss", "2026-11-09T00:00:00Z")]);
  assert.equal(github.mergedPr(86, undefined, "main"), undefined);
  assert.equal(calls("gh").length, 1, "no branch recorded: title lookup only");
});

test("GitLab: same contract over merged MRs into the base", () => {
  serve("glab", [mr(7, "x", "2026-11-04T00:00:00Z")], []);
  assert.deepEqual(gitlab.mergedPr(86, "86-topic", "main"), { number: 7, title: "x", url: "https://mr/7", mergedAt: "2026-11-04T00:00:00Z", matchedBy: "branch" });
  assert.match(calls("glab")[0], /merge_requests\?state=merged&target_branch=main&source_branch=86-topic/);
  serve("glab", [], [mr(8, "#86 no colon", "2026-11-05T00:00:00Z"), mr(9, "#86: Real", "2026-11-04T00:00:00Z")]);
  assert.equal(gitlab.mergedPr(86, "86-topic", "main")?.number, 9);
  assert.match(calls("glab")[1], /state=merged&target_branch=main&in=title&search=%2386%3A/);
  serve("glab", [], []);
  assert.equal(gitlab.mergedPr(86, "86-topic", "main"), undefined);
});
