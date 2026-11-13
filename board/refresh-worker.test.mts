// Refresh worker lifecycle (#78): real synthetic child/grandchild groups with inherited or redirected stdio.
// Check success, failed leaders and timeout cleanup after the leader is gone; unrelated detached work survives.
// Only temporary local commands run. No trackers, agents, Docker, schedulers or real services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ownerOf, ownerState } from "./admission.mts";
import { readAssessment, requestRefresh, writeAssessment } from "./assessment.mts";
import { executeRefresh } from "./refresh-worker.mts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const stdio of ["ignore", "inherit"] as const) {
  for (const outcome of ["success", "failure", "timeout"] as const) {
    test(`${outcome}: worker cleans child and grandchild with ${stdio} stdio, not detached work`, async (t) => {
      const root = mkdtempSync(resolve(tmpdir(), "refresh-group-")), dir = resolve(root, "state"), key = "p--7";
      mkdirSync(resolve(root, ".sandcastle")); mkdirSync(dir);
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
      writeFileSync(resolve(root, ".sandcastle/config.mts"), 'project: "p"\n');
      const record = JSON.stringify({ iid: "7", project: "p", stage: "stopped", pid: process.pid, verdict: "FAIL", branch: "7-topic" });
      writeFileSync(resolve(dir, `${key}.json`), record);
      requestRefresh(dir, key, "7", "p");
      writeAssessment(dir, key, { iid: "7", project: "p", projectRoot: root });
      const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(resolve(root, "grandchild"))}, String(process.pid)); setInterval(() => {}, 1000);`;
      const child = `
        const fs = require('node:fs');
        fs.writeFileSync(${JSON.stringify(resolve(root, "child"))}, String(process.pid));
        require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ${JSON.stringify(stdio)} });
        setInterval(() => {}, 1000);`;
      writeFileSync(resolve(root, ".sandcastle/dispatch.mts"), `
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
