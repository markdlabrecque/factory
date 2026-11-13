// Archive coverage exercises project/header gates, active/queued refusal, preservation and idempotence over HTTP,
// plus delayed-success/error DOM state and corrected-verdict badges. All fixtures are local, never live tracker data.
// Regression tests for the Factory board: appearance settings, the pure run model, the live poller, the
// /api/runs snapshot, the evidence routes (bounded previews, original files, path safety), launch reservations and atomic claims, and marking a card merged outside Factory (#87) and labelling it on the board (#88).
// Tracker coverage includes latest-ten Shipped selection, queue reasons, persisted stage visits, honest legacy stats
// and focus returned to the actual stats control, including removed/hidden-control fallbacks. Assessment DOM assertions
// cover unchecked, fresh, pending-analysis, pending-refresh and failed-with-last-good cards, including reused nodes.
// The browser code is loaded from the template's "// <name>:start" … "// <name>:end" sections.
// Run with node --test board/board.test.mts. All state and evidence are temporary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const template = readFileSync(resolve("board/board.template.html"), "utf8");
const section = (name: string) => template.slice(template.indexOf(`// ${name}:start`), template.indexOf(`// ${name}:end`));
function load(name: string, exports: string[], ctx: Record<string, unknown> = {}): any {
  runInNewContext(section(name) + exports.map((e) => `; this.${e} = ${e};`).join(""), ctx);
  return ctx;
}

test('archive keeps the card until success and exposes errors; corrected badges retain the original', async () => {
  const run = { key: 'group-demo--1', project: 'group/demo', iid: '1', startedAt: '2026-11-01T00:00:00Z' };
  const board = { runs: [run] };
  let respond: (r: any) => void = () => {};
  let request: any;
  let patches = 0;
  const ctx = load('archive', ['archiveCard', 'verdictBadge'], {
    board, announcer: {}, patch: () => patches++,
    fetch: (url: string, options: any) => { request = { url, options }; return new Promise(r => { respond = r; }); },
    el: (_tag: string, className: string, textContent: string) => ({ className, textContent }),
  });
  const c = { archive: { disabled: false }, archiveError: { hidden: true, textContent: '' } };
  const pending = ctx.archiveCard(c, run);
  assert.equal(c.archive.disabled, true);
  assert.equal(board.runs.length, 1, 'not removed optimistically');
  assert.equal(request.url, '/api/projects/group%2Fdemo/tickets/1/archive');
  assert.equal(request.options.headers['x-factory'], '1');
  respond({ ok: false, json: async () => ({ error: 'work is active' }) });
  await pending;
  assert.equal(board.runs.length, 1);
  assert.equal(c.archiveError.hidden, false);
  assert.match(c.archiveError.textContent, /work is active/);
  assert.equal(c.archive.disabled, false);
  const retry = ctx.archiveCard(c, run);
  respond({ ok: true, json: async () => ({ run: 'started:' + run.startedAt }) });
  await retry;
  assert.equal(board.runs.length, 0);
  assert.equal(patches, 1);
  board.runs = [run];
  const raced = ctx.archiveCard(c, run);
  const newer = { ...run, executionId: 'new-execution', stage: 'implementing' };
  board.runs = [newer];
  respond({ ok: true, json: async () => ({ run: 'started:' + run.startedAt }) });
  await raced;
  assert.equal(board.runs[0], newer, 'delayed archive response must not hide a newer polled execution');
  const badge = ctx.verdictBadge({ verdict: 'PASS', originalVerdict: 'FAIL', manuallyCorrected: true });
  assert.equal(badge.textContent, 'Verified · corrected');
  assert.match(badge.title, /Original verdict: FAIL/);
  assert.equal(ctx.verdictBadge({ verdict: 'FAIL' }).textContent, 'FAIL');
  assert.match(template, /aria-label', 'Archive ticket'/);
  assert.match(template, /c.archive.hidden = fileMode \|\| info.group !== 'history'/);
});

test('bad presentation journals cannot interrupt stage writes or evidence rendering', async () => {
  const board = await import('./board.mts');
  const dir = mkdtempSync(resolve(tmpdir(), 'board-bad-journal-'));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  process.env.SANDCASTLE_STATE_DIR = dir;
  try {
    const now = new Date().toISOString();
    writeFileSync(resolve(dir, 'bad--1.json'), JSON.stringify({ project: 'bad', iid: '1', stage: 'done', startedAt: now, updatedAt: now, stageSince: now, pid: process.pid }));
    mkdirSync(resolve(dir, 'journal'));
    writeFileSync(resolve(dir, 'journal/bad--1.json'), '{broken');
    assert.doesNotThrow(() => board.setStage('2', { project: 'other', stage: 'queued' }));
    assert.equal(board.buildBoardData('http').runs.length, 2);
    const bad = board.readRuns().find(r => r.project === 'bad')!;
    assert.doesNotThrow(() => board.buildEvidencePage(bad, []));
  } finally {
    if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appearance keeps light/dark/system, follows the OS live and survives blocked storage", () => {
  const media = { matches: false, listener: () => {}, addEventListener(_: string, fn: () => void) { this.listener = fn; } };
  const root = { dataset: { mode: "system", theme: "light" } as Record<string, string> };
  const saved: Record<string, string> = {};
  const ctx = load("settings", ["setMode"], { root, window: { matchMedia: () => media }, localStorage: { setItem: (k: string, v: string) => { saved[k] = v; } } });
  ctx.setMode("dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(saved["sandcastle-theme"], "dark");
  ctx.setMode("system");
  assert.equal(root.dataset.theme, "light");
  media.matches = true;
  media.listener();
  assert.equal(root.dataset.theme, "dark");
  ctx.setMode("log"); // an old design name is not a mode
  assert.equal(root.dataset.mode, "system");

  const blocked = load("settings", ["setMode"], { root, window: {}, localStorage: { setItem() { throw new Error("denied"); } } });
  blocked.setMode("light");
  assert.equal(root.dataset.theme, "light");
  // The design picker is gone: no design storage key or renderer branches remain.
  assert.doesNotMatch(template, /sandcastle-design|setDesign|data-design/);
});

test("assessment DOM distinguishes unchecked, fresh, pending and failed checks without hiding refresh", () => {
  class Node {
    hidden = false;
    disabled = false;
    children: Node[] = [];
    tag: string;
    className: string;
    private text: string;
    constructor(tag = 'div', className = '', text = '') { this.tag = tag; this.className = className; this.text = text; }
    get textContent(): string { return this.text + this.children.map(n => n.textContent).join(' '); }
    appendChild(n: Node) { this.children.push(n); }
    replaceChildren(...nodes: Node[]) { this.text = ''; this.children = nodes; }
  }
  const ctx = load("assessment", ["renderAssessment"], {
    fileMode: false,
    el: (tag: string, cls?: string, text?: string) => new Node(tag, cls, text),
    add: (parent: Node, ...children: Node[]) => children.forEach(n => parent.appendChild(n)),
    ago: () => '1m',
  });
  const card = { assess: new Node(), refresh: new Node('button', '', 'Refresh ticket') };
  const facts = { state: 'open', selected: true, checkedAt: '2026-11-10T12:00:00Z', model: 'opus' };
  const render = (assessment?: object) => {
    ctx.renderAssessment(card, { title: 'Run title', assessment }, 0);
    assert.equal(card.assess.hidden, false);
    assert.equal(card.refresh.hidden, false);
    assert.equal(card.refresh.disabled, false);
    assert.equal(card.refresh.textContent, 'Refresh ticket');
    return card.assess.textContent;
  };
  assert.equal(render(), 'Current ticket: not checked yet');
  assert.equal(card.assess.children[0].className, 'a-title');
  const fresh = render({ facts, analysisState: 'current' });
  assert.match(fresh, /Current ticket.*Open in tracker.*Model opus.*Checked 1m ago/);
  assert.doesNotMatch(fresh, /not checked|Pending|Refresh requested|failed/i);
  assert.match(render({ facts, analysisState: 'pending' }), /Pending analysis: dependency conclusions are stale/);
  assert.match(render({ facts, pending: { generation: 'g' } }), /Refresh requested: checking current tracker facts/);
  const failed = render({ facts, error: 'tracker unavailable', attemptedAt: facts.checkedAt });
  assert.match(failed, /Open in tracker.*Checked 1m ago.*Last check failed 1m ago: tracker unavailable.*Showing the last good check/);
  assert.ok(card.assess.children.some(n => n.className === 'a-bad' && /Last check failed/.test(n.textContent)));
  assert.equal(render(), 'Current ticket: not checked yet', 'reused cards clear stale facts and errors');
  ctx.fileMode = true;
  ctx.renderAssessment(card, {}, 0);
  assert.equal(card.refresh.hidden, true, 'local snapshots still hide the HTTP action');
  assert.equal(card.assess.hidden, false);
});

test("run model groups every stage, flags attention and rejects unsafe links", () => {
  const m = load("model", ["layout", "summarize", "stageInfo", "matches", "safeHref", "validSnapshot", "shouldPoll", "diffRuns"]);
  const now = Date.parse("2026-11-10T12:00:00Z");
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const run = (key: string, stage: string, minAgo = 1, extra = {}) => ({ key, iid: key, stage, stageSince: at(minAgo), startedAt: at(minAgo + 5), updatedAt: at(minAgo), ...extra });
  const runs = ["queued", "waiting", "setup", "implementing", "verifying", "posting", "pushing", "ci", "done", "stopped", "mystery"].map((s) => run(`a--${s}`, s));
  runs.push(run("b--1", "implementing", 45), run("c--1", "implementing", 2, { project: "c" }));
  const groups = m.layout(runs, now);
  assert.equal(groups.waiting.map((r: any) => r.stage).sort().join(), "queued");
  assert.equal(groups.history.map((r: any) => r.stage).sort().join(), "done");
  assert.equal(groups.active.length, 11);
  assert.equal(groups.active[0].key, "b--1", "a quiet run sorts first");
  assert.equal(m.stageInfo("mystery").label, "mystery");
  assert.equal(m.stageInfo("constructor").unknown, true);
  assert.equal(JSON.stringify(m.summarize(runs, now)), JSON.stringify({ all: 13, active: 9, waiting: 1, attention: 3, done: 1 }));
  assert.equal(m.matches(runs[0], "waiting", "", now), true);
  assert.equal(m.matches(runs[0], "waiting", "c", now), false);

  assert.equal(m.safeHref("javascript:alert(1)", false), null);
  assert.equal(m.safeHref(" JavaScript:alert(1)", false), null);
  assert.equal(m.safeHref("//evil.example/x", false), null);
  assert.equal(m.safeHref("file:///tmp/evidence/", false), null);
  assert.equal(m.safeHref("file:///tmp/evidence/", true), "file:///tmp/evidence/");
  assert.equal(m.safeHref("/evidence/a--1/", false), "/evidence/a--1/");
  assert.equal(m.safeHref("https://github.com/o/r/pull/3", false), "https://github.com/o/r/pull/3");

  assert.equal(m.validSnapshot({ runs: [{ key: "a", stage: "done" }], generatedAt: "x" }), true);
  assert.equal(m.validSnapshot({ runs: [{ stage: "done" }], generatedAt: "x" }), false);
  assert.equal(m.validSnapshot("<html>"), false);
  assert.equal(m.shouldPoll({ runs: [] }, "http:"), true);
  assert.equal(m.shouldPoll({ runs: [] }, "file:"), false);
  assert.equal(m.shouldPoll({ evidence: {} }, "http:"), false);

  const prev = new Map([["a", "setup"], ["b", "ci"], ["gone", "done"]]);
  const d = m.diffRuns(prev, [{ key: "a", stage: "setup" }, { key: "b", stage: "done" }, { key: "new", stage: "queued" }]);
  assert.equal(JSON.stringify(d), JSON.stringify({ added: ["new"], changed: ["b"], removed: ["gone"] }));
});

test("trackers filter secondary capacity and select the latest ten completions after filtering", () => {
  const m = load("model", ["layout", "matches", "queueReasons", "trackerStep"]);
  const now = Date.parse("2026-11-10T12:00:00Z");
  const cap = { code: "docket_full", text: "capacity" }, dep = { code: "dependency", text: "Waiting on #4" };
  assert.equal(m.queueReasons({ queueReasons: [cap] })[0].text, "Docket is full");
  assert.equal(m.queueReasons({ queueReasons: [cap, dep, dep] }).map((r: any) => r.text).join(), "Waiting on #4");
  assert.equal(m.queueReasons({ note: "waiting for a free slot" })[0].text, "Docket is full");
  assert.equal(m.queueReasons({})[0].text, "Queue reason unavailable");
  assert.equal(m.queueReasons({ note: 42 })[0].text, "Queue reason unavailable");
  const runs = Array.from({ length: 15 }, (_, i) => ({ key: String(i).padStart(2, "0"), stage: "done", stageSince: new Date(now - i * 1000).toISOString(), project: i % 2 ? "p" : "q" }));
  const all = m.layout(runs, now).history;
  assert.equal(all.length, 10);
  assert.equal(all.map((r: any) => r.key).join(), "00,01,02,03,04,05,06,07,08,09");
  const project = m.layout(runs.filter(r => m.matches(r, "all", "p", now)), now).history;
  assert.equal(project.length, 7);
  assert.equal(project.at(-1).key, "13", "project filtering precedes the limit");
  assert.equal(m.trackerStep({ stage: "waiting" }), -1, "legacy blocker has no invented current stage");
  assert.equal(m.trackerStep({ stage: "waiting", stageHistory: [{ stage: "implementing", at: new Date(now - 2000).toISOString() }, { stage: "waiting", at: new Date(now - 1000).toISOString() }] }), 2);
  assert.equal(m.trackerStep({ stage: "implementing" }), 2, "a bounce returns to the current stage");
});

test("#88: a card merged outside Factory is labelled with its PR, and an ordinary shipped card is not", () => {
  const m = load("model", ["mergedOutsideText"]);
  const gh = { iid: "7", mr: "https://github.com/o/r/pull/12", mergedAt: "2026-11-12T10:00:00Z", mergedOutside: { pr: 12, matchedBy: "branch" } };
  const label = m.mergedOutsideText(gh);
  assert.equal(label.text, "Merged outside Factory · PR #12");
  assert.match(label.title, /recorded branch.*did not verify it again.*2026-11-12T10:00:00/);
  const gl = m.mergedOutsideText({ iid: "7", mr: "https://gitlab.com/g/p/-/merge_requests/3", mergedOutside: { pr: 3, matchedBy: "title" } });
  assert.equal(gl.text, "Merged outside Factory · MR !3");
  assert.match(gl.title, /"#7:" title/);
  // Factory's own merge (mergedAt without mergedOutside) gets no label.
  assert.equal(m.mergedOutsideText({ iid: "8", stage: "done", verdict: "PASS", mr: gh.mr, mergedAt: gh.mergedAt }), null);
});

test("real visit stats count holds, repeated stages and bounces without inventing legacy totals", () => {
  const m = load("model", ["ticketStats", "duration"]);
  const at = (s: number) => new Date(s * 1000).toISOString();
  const stages = ["queued", "setup", "implementing", "waiting", "implementing", "verifying", "implementing", "verifying", "done"];
  const run = { stage: "done", startedAt: at(0), stageSince: at(80), historyComplete: true,
    stageHistory: stages.map((stage, i) => ({ stage, at: at(i * 10), note: stage === "waiting" ? "Needs approval" : undefined })) };
  const stats = m.ticketStats(run, 500_000);
  assert.equal(stats.complete, true);
  assert.equal(stats.running, 60_000);
  assert.equal(stats.queued, 10_000);
  assert.equal(stats.blocked, 10_000);
  assert.equal(stats.elapsed, 80_000);
  assert.equal(stats.totals.implementing, 30_000);
  assert.equal(stats.visits.implementing, 2, "a hold does not add a visit");
  assert.equal(stats.bounces.length, 1);
  const legacy = m.ticketStats({ stage: "done", startedAt: at(0), stageSince: at(80) }, 500_000);
  assert.equal(legacy.complete, false);
  assert.equal(legacy.elapsed, 80_000);
  assert.equal(legacy.totals.implementing, undefined);
  assert.equal(m.ticketStats({ stage: "done", startedAt: at(0), stageSince: "unknown" }, 500_000).elapsed, null);
  const corrupt = m.ticketStats({ ...run, stageHistory: [null, { stage: "verifying", at: "bad" }] }, 500_000);
  assert.equal(corrupt.complete, false);
  const mixedWriter = m.ticketStats({ ...run, stage: "verifying", stageSince: at(75), stageHistory: run.stageHistory.slice(0, 7) }, 80_000);
  assert.equal(mixedWriter.complete, false, "an older writer cannot silently extend complete history");
  assert.equal(mixedWriter.totals.verifying, 15_000, "the known current stage is retained alongside earlier recorded visits");
  assert.equal(m.duration(null), "Unavailable");
  assert.equal(m.duration(3_723_000), "1:02:03");
});

test("stage history records changes and parked reasons, not heartbeats, and marks legacy history incomplete", async () => {
  const { trackStage } = await import("./board.mts");
  const at = (s: number) => new Date(s * 1000).toISOString();
  let run = { iid: "1", pid: process.pid, stage: "queued", startedAt: at(0), stageSince: at(0), updatedAt: at(0), note: "waiting for a free slot" } as import("./board.mts").RunState;
  run = trackStage({}, run, at(0));
  assert.equal(run.historyComplete, true);
  let next = trackStage(run, { ...run, updatedAt: at(1) }, at(1));
  assert.equal(next.stageHistory!.length, 1);
  next = trackStage(next, { ...next, note: "Needs approval" }, at(2));
  assert.equal(next.stageHistory!.length, 2);
  next = trackStage(next, { ...next, stage: "implementing", stageSince: at(3) }, at(3));
  assert.equal(next.stageHistory!.length, 3);
  const legacy = trackStage({ ...run, stageHistory: undefined, historyComplete: undefined }, { ...run, stage: "setup" }, at(4));
  assert.equal(legacy.historyComplete, false);
  assert.equal(legacy.stageHistory!.length, 2);
  const mixedWriter = trackStage({ ...next, stage: "verifying", stageSince: at(4) }, { ...next, stage: "done", stageSince: at(5) }, at(5));
  assert.equal(mixedWriter.historyComplete, false);
  assert.deepEqual(mixedWriter.stageHistory!.slice(-2).map(v => v.stage), ["verifying", "done"]);
  const reopened = trackStage({ ...next, stage: "done" }, { ...next, stage: "setup" }, at(5));
  assert.equal(reopened.stageHistory!.length, 1);
  assert.equal(reopened.historyComplete, true);
  const bounded = trackStage({ ...next, stageHistory: Array.from({ length: 1000 }, () => ({ stage: "setup", at: at(0) })) }, { ...next, stage: "verifying" }, at(6));
  assert.equal(bounded.stageHistory!.length, 1000);
  assert.equal(bounded.historyComplete, false);
});

test("closing stats restores the invoking control or the Shipped fallback", () => {
  let focused: any;
  const control = () => ({ isConnected: true, hidden: false, closest() { return this.hidden; }, focus() { focused = this; } });
  const title = control(), viewStats = control(), summary = control();
  const listeners: Record<string, () => void> = {};
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; listeners.close(); }, addEventListener(name: string, fn: () => void) { listeners[name] = fn; } };
  const close = { addEventListener(_: string, fn: () => void) { listeners.click = fn; } };
  const board: any = {};
  const m = load("stats-focus", ["openStats"], { board, renderStats() {}, document: {
    activeElement: title,
    getElementById(id: string) { return id === "ticket-stats" ? dialog : close; },
    querySelector() { return summary; },
  } });
  for (const invoking of [title, viewStats]) {
    m.openStats("demo--1", invoking);
    assert.equal(board.selectedKey, "demo--1");
    listeners.click(); // Close button
    assert.equal(focused, invoking);
    assert.equal(board.selectedKey, null);
    m.openStats("demo--1", invoking);
    dialog.close(); // Native Escape reaches the same close event
    assert.equal(focused, invoking);
  }
  viewStats.isConnected = false;
  m.openStats("demo--1", viewStats); dialog.close();
  assert.equal(focused, summary);
  title.hidden = true;
  m.openStats("demo--1", title); dialog.close();
  assert.equal(focused, summary);
});

test("poller keeps one loop, pauses while hidden and keeps last data on failure", async () => {
  const { createPoller } = load("poller", ["createPoller"], { Promise, Error });
  const timers = new Map<number, () => void>();
  let nextId = 0, hidden = false, inFlight = 0, maxInFlight = 0, calls = 0;
  const responses: Array<() => Promise<any>> = [];
  const got: any[] = [], errors: string[] = [];
  const p = createPoller({
    url: "/api/runs", interval: 10_000,
    setTimeout: (fn: () => void) => { timers.set(++nextId, fn); return nextId; },
    clearTimeout: (id: number) => { timers.delete(id); },
    isHidden: () => hidden,
    valid: (d: any) => Array.isArray(d?.runs),
    fetch: async () => {
      calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { return await responses.shift()!(); } finally { inFlight--; }
    },
    onData: (d: any) => got.push(d),
    onError: (e: Error) => errors.push(e.message),
  });
  const ok = (body: any) => async () => ({ ok: true, json: async () => body });
  const fire = async () => { const [id, fn] = [...timers][0]; timers.delete(id); fn(); await new Promise((r) => setTimeout(r, 0)); };

  p.start();
  assert.equal(timers.size, 1);
  responses.push(ok({ runs: [1] }));
  await fire();
  assert.equal(got.length, 1);
  assert.equal(timers.size, 1, "reschedules exactly once");

  responses.push(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await fire();
  responses.push(ok("<html>not json data</html>"));
  await fire();
  assert.deepEqual(errors, ["HTTP 500", "malformed snapshot"]);
  assert.equal(got.length, 1, "failures keep the last good data");
  assert.equal(timers.size, 1);

  hidden = true;
  p.visibilityChanged();
  assert.equal(timers.size, 0, "no polling in a hidden tab");
  hidden = false;
  responses.push(ok({ runs: [2] }));
  p.visibilityChanged();
  p.visibilityChanged(); // a second event while the request is in flight must not start another
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(got.length, 2);
  assert.equal(maxInFlight, 1);
  assert.equal(calls, 4);
  assert.equal(timers.size, 1);
});

test("board, /api/runs and evidence agree and render safely", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "sandcastle-board-test-"));
  const evidence = resolve(dir, "evidence");
  mkdirSync(evidence);
  mkdirSync(resolve(evidence, "not-a-file"));
  writeFileSync(resolve(evidence, "verdict.md"), "PASS\n</script><script>alert('unsafe')</script>");
  writeFileSync(resolve(evidence, "large.log"), "x".repeat(70 * 1024));
  writeFileSync(resolve(evidence, "screen shot.png"), "image bytes");
  writeFileSync(resolve(evidence, "demo.webm"), "video bytes");
  writeFileSync(resolve(evidence, "archive.zip"), "archive bytes");
  writeFileSync(resolve(evidence, ".hidden"), "hidden");
  const now = new Date().toISOString();
  const record = { stage: "done", stageSince: now, startedAt: now, updatedAt: now, pid: process.pid };
  writeFileSync(resolve(dir, "demo--1.json"), JSON.stringify({ ...record, iid: "1", title: "Example $& </script><b>", project: "demo", evidenceDir: evidence }));
  writeFileSync(resolve(dir, "other--1.json"), JSON.stringify({ ...record, iid: "1", title: "Same number, other project", project: "other", stage: "queued" }));
  const child = spawn(process.execPath, [resolve("board/board-server.mts")], {
    env: { ...process.env, SANDCASTLE_STATE_DIR: dir, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [output] = await once(child.stdout!, "data");
    const base = String(output).match(/http:\/\/[^\s]+/)![0];
    const board = await (await fetch(base)).text();
    assert.match(board, /class="app-nav"/);
    assert.match(board, /id="settings"/);
    assert.doesNotMatch(board, /fonts\.googleapis|sandcastle-refresh|location\.reload/);
    assert.doesNotMatch(board, /<b>/);
    const embedded = JSON.parse(board.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)![1]);
    assert.equal(embedded.runs.find((r: any) => r.key === "demo--1").title, "Example $& </script><b>");

    const api = await fetch(base + "/api/runs");
    assert.match(api.headers.get("content-type")!, /^application\/json/);
    assert.equal(api.headers.get("cache-control"), "no-store");
    const snapshot = await api.json();
    const view = (d: any) => d.runs.map((r: any) => [r.key, r.stage, r.project, r.evidenceUrl]);
    assert.deepEqual(view(snapshot), view(embedded));
    assert.deepEqual(view(snapshot).map((r: any) => r[0]).sort(), ["demo--1", "other--1"]);
    assert.equal(snapshot.runs.find((r: any) => r.key === "demo--1").evidenceUrl, "/evidence/demo--1/");

    const response = await fetch(base + "/evidence/demo--1/");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /class="app-nav"/);
    assert.doesNotMatch(html, /<script>alert/);
    const data = JSON.parse(html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)![1]);
    const files = data.evidence.files;
    assert.equal(files.length, 5);
    assert.equal(files.find((f: any) => f.name === "large.log").text.length, 64 * 1024);
    assert.equal(files.find((f: any) => f.name === "large.log").truncated, true);
    assert.equal(files.find((f: any) => f.name.endsWith("png")).kind, "image");
    assert.equal(files.find((f: any) => f.name.endsWith("webm")).kind, "video");
    assert.equal(files.find((f: any) => f.name.endsWith("zip")).kind, "file");
    const image = await fetch(base + "/evidence/demo--1/screen%20shot.png");
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(await image.text(), "image bytes");
    assert.equal((await fetch(base + "/evidence/missing/")).status, 404);
    assert.equal((await fetch(base + "/evidence/demo--1/not-a-file")).status, 404);
    assert.equal((await fetch(base + "/evidence/demo--1/%E0%A4%A")).status, 404);
    assert.equal((await fetch(base + "/api/runs/x")).status, 404);
    const archive = (project: string, method = 'POST', headers: Record<string, string> = { 'x-factory': '1' }) =>
      fetch(base + '/api/projects/' + encodeURIComponent(project) + '/tickets/1/archive', { method, headers });
    assert.equal((await archive('demo', 'GET')).status, 405);
    assert.equal((await archive('demo', 'POST', {})).status, 405);
    assert.equal((await archive('other')).status, 409, 'queued work refused');
    writeFileSync(resolve(dir, 'other--1.json'), JSON.stringify({ ...record, project: 'other', iid: '1', stage: 'implementing' }));
    assert.equal((await archive('other')).status, 409, 'active work refused');
    assert.equal((await archive('missing')).status, 409);
    const original = readFileSync(resolve(dir, 'demo--1.json'), 'utf8');
    assert.equal((await archive('demo')).status, 200);
    assert.equal((await archive('demo')).status, 200, 'idempotent');
    const journal = JSON.parse(readFileSync(resolve(dir, 'journal/demo--1.json'), 'utf8'));
    assert.equal(journal.events.length, 1);
    const after = await (await fetch(base + '/api/runs')).json();
    assert.deepEqual(after.runs.map((r: any) => r.key), ['other--1']);
    assert.equal(readFileSync(resolve(dir, 'demo--1.json'), 'utf8'), original);
    assert.equal((await fetch(base + '/evidence/demo--1/')).status, 200);
    assert.equal(await (await fetch(base + '/evidence/demo--1/archive.zip')).text(), 'archive bytes');
    for (const name of ["verdict.md", "large.log", "screen shot.png", "demo.webm", "archive.zip"]) rmSync(resolve(evidence, name));
    const emptyHtml = await (await fetch(base + "/evidence/demo--1/")).text();
    assert.match(emptyHtml, /"files":\[\]/);
  } finally {
    child.kill();
    await once(child, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an in-progress run shows the last line of its newest agent log; parked and finished runs show none", async () => {
  const { latestActivity } = await import("./board.mts");
  const dir = mkdtempSync(resolve(tmpdir(), "board-activity-"));
  try {
    const logs = resolve(dir, ".sandcastle/logs");
    mkdirSync(logs, { recursive: true });
    writeFileSync(resolve(logs, "feat-implementer.log"), "old\n");
    writeFileSync(resolve(logs, "other-implementer.log"), "not this branch\n");
    writeFileSync(resolve(logs, "feat-verifier.log"), "\u001b[1mStarted\u001b[0m\nRunning the tests now\n\n");
    utimesSync(resolve(logs, "feat-implementer.log"), 1000, 1000); // older than the verifier's log
    const run = { iid: "1", stage: "verifying", branch: "feat", evidenceDir: resolve(dir, ".sandcastle/evidence/1") } as any;
    assert.equal(latestActivity(run)?.activity, "Running the tests now");
    assert.equal(latestActivity({ ...run, stage: "queued" }), undefined);
    assert.equal(latestActivity({ ...run, stage: "done" }), undefined);
    assert.equal(latestActivity({ ...run, branch: "missing" }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a launched run counts as active before its child writes, and vanishes if the child dies unstarted", async () => {
  const board = await import("./board.mts");
  const dir = mkdtempSync(resolve(tmpdir(), "board-reserve-"));
  const cwd = process.cwd();
  const prevState = process.env.SANDCASTLE_STATE_DIR;
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    process.chdir(dir);
    process.env.SANDCASTLE_STATE_DIR = resolve(dir, "state");
    board.setProject("p");
    board.setStage("7", { stage: "queued", title: "Seven", note: "no room" });
    board.reserveRun("7", child.pid!);
    let [run] = board.readRuns();
    assert.equal(run.stage, "setup", "a reservation is in flight, so it counts against the cap");
    assert.equal(run.pid, child.pid);
    assert.equal(run.title, "Seven");
    assert.deepEqual(run.stageHistory!.map(v => v.stage), ["queued", "setup"]);
    assert.equal(run.historyComplete, true);
    child.kill();
    await once(child, "exit");
    assert.deepEqual(board.readRuns(), [], "an unstarted launch is forgotten, not stopped, so the next pass retries it");

    // Once the run writes for itself, it owns the record: a later crash is a stopped run as before.
    board.reserveRun("8", process.pid);
    board.setStage("8", { stage: "setup", starting: undefined, pid: 2 ** 22 + 12345 });
    [run] = board.readRuns();
    assert.equal(run.stage, "stopped");
    assert.equal(run.stageHistory!.at(-1)!.stage, "stopped");
  } finally {
    child.kill();
    process.chdir(cwd);
    if (prevState === undefined) delete process.env.SANDCASTLE_STATE_DIR;
    else process.env.SANDCASTLE_STATE_DIR = prevState;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claims are atomic: concurrent claimants never exceed the cap or take one ticket twice", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "board-claim-"));
  const state = resolve(dir, "state");
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    const board = await import("./board.mts");
    // Another project's run already holds one of two slots.
    board.claimRun({ dir: state, project: "other", iid: "1", pid: sleeper.pid!, cap: 2 });
    assert.equal(board.claimRun({ dir: state, project: "other", iid: "1", pid: sleeper.pid!, cap: 9 }).ok, false, "a ticket in flight is owned");
    // Eight processes race for the last slot, two of them for the same ticket; each lingers between check and write.
    const url = new URL("./board.mts", import.meta.url).href;
    const racers = Array.from({ length: 8 }, (_, n) => {
      const code = `const b = await import(${JSON.stringify(url)}); const c = b.claimRun({ dir: ${JSON.stringify(state)}, project: "p", iid: "${n % 4 === 0 ? 5 : 10 + n}", pid: ${sleeper.pid}, cap: 2, also: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); } }); process.stdout.write(c.ok ? "won" : c.reason);`;
      const c = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      return once(c, "exit").then(() => out);
    });
    const results = await Promise.all(racers);
    assert.equal(results.filter((r) => r === "won").length, 1, results.join("\n"));
    assert.ok(results.filter((r) => r !== "won").every((r) => /no capacity|already has a run in flight/.test(r)), results.join("\n"));
    assert.equal(board.readRuns(state).filter((r) => r.stage === "setup").length, 2);

    // A refused `also` writes nothing; an accepted one adds its fields over the existing record.
    board.setProject("q");
    const queued = { dir: state, project: "q", iid: "3", pid: sleeper.pid!, cap: 9 };
    assert.deepEqual(board.claimRun({ ...queued, also: () => { throw new Error("project busy"); } }), { ok: false, reason: "project busy" });
    assert.equal(board.readRuns(state).some((r) => r.project === "q"), false);
  } finally {
    sleeper.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#87: a stopped or parked card merged outside Factory moves to done with its PR, keeping its verdict; a claimed card is left alone", async () => {
  const board = await import("./board.mts");
  const dir = mkdtempSync(resolve(tmpdir(), "board-merged-outside-"));
  const cwd = process.cwd();
  const prevState = process.env.SANDCASTLE_STATE_DIR;
  const state = resolve(dir, "state");
  const pr = { number: 41, url: "https://example.test/pr/41", mergedAt: "2026-11-01T10:00:00Z", matchedBy: "title" as const };
  try {
    process.chdir(dir);
    process.env.SANDCASTLE_STATE_DIR = state;
    board.setProject("p");
    board.setStage("7", { stage: "stopped", verdict: "FAIL", branch: "7-fix", note: "verifier said FAIL" });
    assert.equal(board.markMergedOutside("7", "queued", pr), false, "a card no longer at the expected stage is left alone");
    assert.equal(board.markMergedOutside("7", "stopped", pr), true);
    const [run] = board.readRuns();
    assert.equal(run.stage, "done");
    assert.equal(run.verdict, "FAIL", "the original verdict is kept");
    assert.equal(run.mr, pr.url);
    assert.equal(run.mergedAt, pr.mergedAt);
    assert.deepEqual(run.mergedOutside, { pr: 41, matchedBy: "title" });
    assert.deepEqual(run.stageHistory!.map((v) => v.stage), ["stopped", "done"]);
    assert.equal(board.markMergedOutside("7", "done", pr), false, "a done card is not marked again");

    // A queued card a run claimed after the dispatcher read the board is not overwritten.
    board.setStage("8", { stage: "queued", note: "no room" });
    assert.equal(board.claimRun({ iid: "8", pid: process.pid, cap: 9 }).ok, true);
    board.setStage("8", { stage: "queued" }); // even back at the read stage, the live claim still owns it
    assert.equal(board.markMergedOutside("8", "queued", pr), false);
    assert.equal(board.readRuns().find((r) => r.iid === "8")!.mergedOutside, undefined);
  } finally {
    process.chdir(cwd);
    if (prevState === undefined) delete process.env.SANDCASTLE_STATE_DIR;
    else process.env.SANDCASTLE_STATE_DIR = prevState;
    rmSync(dir, { recursive: true, force: true });
  }
});
