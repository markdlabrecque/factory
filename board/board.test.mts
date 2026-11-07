// Regression tests for the shared shell, Settings (design + mode), bounded previews and original files.
// Run with node --test board/board.test.mts. All state and evidence are temporary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("settings save design and mode, and system mode follows the OS", () => {
  const template = readFileSync(resolve("board/board.template.html"), "utf8");
  const script = template.slice(template.indexOf("// settings:start"), template.indexOf("// settings:end"));
  const saved: Record<string, string> = {};
  const media = { matches: false, listener: () => {}, addEventListener(_: string, fn: () => void) { this.listener = fn; } };
  const root = { dataset: { mode: "system", theme: "light", design: "log" } as Record<string, string> };
  let renders = 0;
  const ctx: any = { root, window: { matchMedia: () => media }, localStorage: { setItem: (k: string, v: string) => { saved[k] = v; } }, render: () => { renders++; } };
  runInNewContext(script + "; this.setMode = setMode; this.setDesign = setDesign;", ctx);
  ctx.setMode("dark");
  assert.equal(root.dataset.theme, "dark");
  assert.equal(saved["sandcastle-theme"], "dark");
  ctx.setMode("system");
  assert.equal(root.dataset.theme, "light");
  media.matches = true;
  media.listener();
  assert.equal(root.dataset.theme, "dark");
  ctx.setDesign("castle");
  assert.equal(root.dataset.design, "castle");
  assert.equal(saved["sandcastle-design"], "castle");
  assert.equal(renders, 1);
  ctx.setDesign("bogus");
  assert.equal(root.dataset.design, "castle");
});

test("board and evidence share navigation, theme and safe previews", async () => {
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
  writeFileSync(resolve(dir, "demo--1.json"), JSON.stringify({ iid: "1", title: "Example", project: "demo", stage: "done", stageSince: now, startedAt: now, updatedAt: now, pid: process.pid, evidenceDir: evidence }));
  const child = spawn(process.execPath, [resolve("board/board-server.mts")], {
    env: { ...process.env, SANDCASTLE_STATE_DIR: dir, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [output] = await once(child.stdout!, "data");
    const base = String(output).match(/http:\/\/[^\s]+/)![0];
    const board = await (await fetch(base)).text();
    assert.match(board, /class="app-nav"/);
    assert.match(board, /sandcastle-theme/);
    assert.match(board, /id="settings"/);
    assert.match(board, /<meta name="sandcastle-refresh"/);
    assert.match(board, /\/evidence\/demo--1\//);
    const response = await fetch(base + "/evidence/demo--1/");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /class="app-nav"/);
    assert.doesNotMatch(html, /<meta name="sandcastle-refresh"/);
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
    for (const name of ["verdict.md", "large.log", "screen shot.png", "demo.webm", "archive.zip"]) rmSync(resolve(evidence, name));
    const emptyHtml = await (await fetch(base + "/evidence/demo--1/")).text();
    assert.match(emptyHtml, /"files":\[\]/);
  } finally {
    child.kill();
    await once(child, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
});
