// Refresh worker lifecycle (#78): real synthetic child/grandchild groups with inherited or redirected stdio.
// Check success, failed leaders and timeout cleanup after the leader is gone; unrelated detached work survives.
// Only temporary local commands run. No trackers, agents, Docker, schedulers or real services.
import { projectFixture } from '../cli/test/workflow-fixture.mts';
import { paths } from '../cli/src/paths.mts';
import { factoryToml } from '../cli/test/config-fixture.mts';
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ownerOf, ownerState } from "./admission.mts";
import { readAssessment, requestRefresh, writeAssessment } from "./assessment.mts";
import { executeRefresh } from "./refresh-worker.mts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function localGit(root: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
}
for (const stdio of ["ignore", "inherit"] as const) {
  for (const outcome of ["success", "failure", "timeout"] as const) {
    test(`${outcome}: worker cleans child and grandchild with ${stdio} stdio, not detached work`, async (t) => {
      const root = mkdtempSync(resolve(tmpdir(), "refresh-group-")), dir = resolve(root, "state"), key = "p--7";
      mkdirSync(resolve(root, ".factory")); mkdirSync(dir);
      const saved = { ...process.env };
      Object.assign(process.env, { HOME: root, FACTORY_HOME: root, SANDCASTLE_STATE_DIR: dir });
      const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
      const detachedOwner = ownerOf(unrelated.pid!);
      t.after(async () => {
        try { process.kill(-unrelated.pid!, "SIGKILL"); } catch { /* already gone */ }
        if (unrelated.exitCode === null && unrelated.signalCode === null) await once(unrelated, "exit");
        for (const name of ["leader", "child", "grandchild"]) {
          try { process.kill(Number(readFileSync(resolve(root, name), "utf8")), "SIGKILL"); } catch { /* gone */ }
        }
        for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
        Object.assign(process.env, saved);
        rmSync(root, { recursive: true, force: true });
      });
      writeFileSync(resolve(root, ".factory/factory.toml"), factoryToml('p'));
      const record = JSON.stringify({ iid: "7", project: "p", stage: "stopped", pid: process.pid, verdict: "FAIL", branch: "7-topic", evidenceDir: resolve(root, '.factory/evidence/7') });
      writeFileSync(resolve(dir, `${key}.json`), record);
      requestRefresh(dir, key, "7", "p");
      writeAssessment(dir, key, { iid: "7", project: "p", projectRoot: root });
      const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(resolve(root, "grandchild"))}, String(process.pid)); setInterval(() => {}, 1000);`;
      const child = `
        const fs = require('node:fs');
        fs.writeFileSync(${JSON.stringify(resolve(root, "child"))}, String(process.pid));
        require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ${JSON.stringify(stdio)} });
        setInterval(() => {}, 1000);`;
      mkdirSync(resolve(root, ".factory-workflow"));
      writeFileSync(resolve(root, ".factory-workflow/dispatch.mts"), `
        import { spawn } from 'node:child_process';
        import { existsSync, writeFileSync } from 'node:fs';
        import { clearRequest, pendingRequests } from ${JSON.stringify(new URL("./assessment.mts", import.meta.url).href)};
        writeFileSync(${JSON.stringify(resolve(root, "leader"))}, String(process.pid));
        spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ${JSON.stringify(stdio)} });
        while (!existsSync(${JSON.stringify(resolve(root, "grandchild"))})) await new Promise(r => setTimeout(r, 5));
        ${outcome === "timeout" ? "setInterval(() => {}, 1000);" : `
          ${outcome === "success" ? "clearRequest(process.env.SANDCASTLE_STATE_DIR, 'p--7', pendingRequests(process.env.SANDCASTLE_STATE_DIR).get('p--7'));" : ""}
          process.exit(${outcome === "success" ? 0 : 1});`}
      `);
      localGit(root); projectFixture(paths(root), root);
      process.env.FACTORY_RUNTIME_DESCRIPTOR = paths(root).runtimeDescriptor;
      const first = executeRefresh(key, outcome === "timeout" ? 1500 : 5000);
      assert.equal(first, executeRefresh(key), "same card shares its in-flight worker");
      await first;
      for (const name of ["leader", "child", "grandchild"]) {
        assert.ok(existsSync(resolve(root, name)), `${name} started`);
        const owner = ownerOf(Number(readFileSync(resolve(root, name), "utf8")));
        const deadline = Date.now() + 2000;
        while (ownerState(owner) !== "dead" && Date.now() < deadline) await sleep(10);
        assert.equal(ownerState(owner), "dead", `${name} no longer runs, even after leader exit`);
      }
      assert.notEqual(ownerState(detachedOwner), "dead", "unrelated detached process survives");
      const a = readAssessment(dir, key)!;
      if (outcome === "success") assert.equal(a.error, undefined);
      else assert.match(a.error!, outcome === "timeout" ? /timed out/ : /exited 1/);
      assert.equal(a.pending, false);
      assert.equal(readFileSync(resolve(dir, `${key}.json`), "utf8"), record);
      assert.equal(existsSync(resolve(dir, "admission")), false);
    });
  }
}
test('explicit Board refresh applies the host gate before an opaque project override', async t => {
  const root = mkdtempSync(resolve(tmpdir(), 'refresh-hold-')), dir = resolve(root, 'state'), key = 'p--7';
  const saved = { ...process.env };
  t.after(() => { for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name]; Object.assign(process.env, saved); rmSync(root, {recursive:true,force:true}); });
  Object.assign(process.env, { HOME:root, FACTORY_HOME:root, SANDCASTLE_STATE_DIR:dir });
  mkdirSync(resolve(root, '.factory')); mkdirSync(dir); mkdirSync(resolve(root, '.factory-workflow')); mkdirSync(resolve(root, 'outside'));
  writeFileSync(resolve(root, '.factory/factory.toml'), factoryToml('p'));
  writeFileSync(resolve(root, '.factory-workflow/dispatch.mts'), `import {writeFileSync} from 'node:fs'; writeFileSync('started', 'unsafe');`);
  localGit(root); projectFixture(paths(root), root); process.env.FACTORY_RUNTIME_DESCRIPTOR = paths(root).runtimeDescriptor;
  symlinkSync(resolve(root, 'outside'), resolve(root, '.factory/logs'));
  const record = JSON.stringify({iid:'7', project:'p', stage:'stopped', verdict:'FAIL', branch:'7-saved', evidenceDir: resolve(root, '.factory/evidence/7')});
  writeFileSync(resolve(dir, `${key}.json`), record); writeAssessment(dir, key, {iid:'7',project:'p',projectRoot:root}); requestRefresh(dir, key, '7', 'p');
  await executeRefresh(key);
  assert.match(readAssessment(dir, key)?.error ?? '', /Factory project held/);
  assert.equal(existsSync(resolve(root, 'started')), false); assert.equal(existsSync(resolve(dir, 'admission')), false);
  assert.equal(readFileSync(resolve(dir, `${key}.json`), 'utf8'), record);
});
