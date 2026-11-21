// Shared disposable copied-runtime/tracker fixture for the partitioned refresh integration suites.
import { createProof } from './verification.mts';
import { bindExecution, executionSnapshot } from '../cli/test/execution-fixture.mts';
import { modelForRole } from './model-policy.mts';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAssets } from "../cli/src/scaffold.mts";
import { readAssessment, requestRefresh } from "../board/assessment.mts";
import { fixtureTicketHash } from './fixtures/ticket-input.mts';

import { readAdmission } from '../board/admission.mts';
/** Refresh may own a durable managed entry, never an implementation/recovery admission or generation. */
export function assertUnchargedAdmission(dir: string): void {
  const state = readAdmission(dir);
  assert.deepEqual(state.claims, {}); assert.deepEqual(state.generations, {});
  assert.deepEqual(state.recovery, {}); assert.deepEqual(state.supervisorHolds, {});
}

export const FIXTURES = join(import.meta.dirname, "fixtures/entrypoint");
export const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// Selected fixtures use v2 model tiers. No model label is required.
export const ticket = (iid: number, extra = {}) => ({ iid, title: `Ticket ${iid}`, description: "Model tier: mid\nRequirement DEP:20", state: "open", labels: ["ready-for-agent"], ...extra });
export function fixture(t: any, kind = "github") {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "factory-refresh-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const origin = join(home, "origin.git"), root = join(home, "site"), dir = join(home, "runs"), bin = join(home, "bin"), fake = join(home, "fake");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, root], { stdio: "ignore" });
  git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  git(root, "push", "-q", "origin", "main");
  for (const f of buildAssets({ profile: kind === "github" ? "personal" : "client", repo: "owner/repo", image: "img", host: "git.example.test", projectId: 1 }, dir)) {
    mkdirSync(dirname(join(root, f.path)), { recursive: true });
    writeFileSync(join(root, f.path), f.content, { mode: f.mode });
  }
  const configPath = join(root, '.factory/factory.toml');
  writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('family = "openai"', 'family = "anthropic"'));
  for (const p of [bin, fake, dir, join(dir, "graph"), join(dir, "admission")]) mkdirSync(p, { recursive: true });
  // A fixture-local Node path makes dispatch select our npx rather than the host's. It records the launch only.
  const node = join(bin, "node");
  try { linkSync(process.execPath, node); } catch { copyFileSync(process.execPath, node); chmodSync(node, 0o755); }
  for (const tool of ["gh", "glab", "pi", "claude"]) {
    const script = tool === "gh" || tool === "glab" ? "refresh-tracker.mjs" : "refresh-analysis.mjs";
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${node}" "${join(FIXTURES, script)}" "$@"\n`, { mode: 0o755 });
  }
  writeFileSync(join(bin, "npx"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$FAKE_STATE/launches"\nsleep 1\n`, { mode: 0o755 });
  const extension = join(fake, "subscription-extension.ts");
  // Only its existence is checked by production argument construction; the stub must never load a real provider.
  writeFileSync(extension, 'throw new Error("Fixture extension must not execute");\n');
  const env = { ...process.env, HOME: home, FACTORY_HOME: home, SANDCASTLE_STATE_DIR: dir, FAKE_STATE: fake, FAKE_TRACKER: kind,
    FACTORY_PI_SUBSCRIPTION_EXTENSION: extension, PATH: `${bin}:/usr/bin:/bin` };
  const runtime = bindExecution(root, env, { install: dir => {
    writeFileSync(join(dir, 'node_modules/tsx/dist/cli.mjs'), `import {appendFileSync,writeFileSync} from 'node:fs'; writeFileSync(process.env.FAKE_STATE+'/launch-context',JSON.stringify({project:process.env.FACTORY_PROJECT_ROOT,runtime:process.env.FACTORY_RUNTIME_ROOT,id:process.env.FACTORY_RUNTIME_ID})); appendFileSync(process.env.FAKE_STATE+'/launches',process.argv.slice(2).join(' ')+'\\n'); await new Promise(r=>setTimeout(r,1000));`);
  } });
  Object.assign(env, runtime.env);
  const snapshot = executionSnapshot(runtime, root);
  // Temporary caller bridge for Board routing, which is owned by the next task.
  writeFileSync(join(root, '.factory/dispatch.mts'), `await import(${JSON.stringify(join(runtime.directory, 'dispatch.mts'))});`);
  const data: any = { tickets: [ticket(7), ticket(20, { description: "Provider", labels: [] }), ticket(21, { description: "New provider", labels: [] })], ready: [7], notes: {}, parents: {} };
  const save = () => writeFileSync(join(fake, "tracker.json"), JSON.stringify(data));
  const key = (iid: number) => `owner_repo--${iid}`;
  const record = (iid: number, stage: string) => {
    const r = { iid: String(iid), project: "owner/repo", title: `old ${iid}`, stage, pid: process.pid, base: "main", verdict: "FAIL", branch: `${iid}-topic`,
      ticketHash: "old", archivedAt: "then", correction: "kept", stageSince: "2026-01-01", startedAt: "2026-01-01", updatedAt: "2026-01-01",
      stageHistory: [{ stage: "queued", at: "2026-01-01" }, { stage, at: "2026-01-02" }], evidenceDir: join(root, '.factory/evidence', String(iid), 'prior-execution'), claim: "historical" };
    writeFileSync(join(dir, `${key(iid)}.json`), JSON.stringify(r));
    return readFileSync(join(dir, `${key(iid)}.json`), "utf8");
  };
  const manifest = (iid: number) => {
    const ti = data.tickets.find((x: any) => x.iid === iid), p = data.parents[iid] && data.tickets.find((x: any) => x.iid === data.parents[iid]);
    const m = { iid, project: "owner/repo", policyIdentity: snapshot.policyIdentity, hash: fixtureTicketHash(data, iid, kind), analyzedAt: new Date().toISOString(),
      base: "main", baseSha: "", provides: [], requires: [], footprint: [], actualFootprint: [], catalogueIids: data.tickets.filter((t: any) => !t.contextOnly).map((t: any) => t.iid), blockerHashes: {} };
    writeFileSync(join(dir, "graph", `${key(iid)}.json`), JSON.stringify(m));
  };
  const launchLog = join(fake, 'launches');
  const readLaunchLog = () => existsSync(launchLog) ? readFileSync(launchLog, 'utf8') : undefined;
  const pass = (args: string[] = [], extra = {}) => {
    const before = readLaunchLog();
    save();
    const r = spawnSync(node, [join(runtime.directory, 'dispatch.mts'), "--base", "main", ...args], { cwd: root, encoding: "utf8", env: { ...env, ...extra }, timeout: 20_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    if (/launching/.test(r.stdout) && !/not launched/.test(r.stdout)) {
      const deadline = Date.now() + 2000;
      // The detached stub creates the file before writing a newline-terminated record.
      const completeAppend = (log: string | undefined) => {
        const appended = log?.slice(before?.length ?? 0);
        return appended?.endsWith('\n') && appended.trim().length > 0;
      };
      let log = readLaunchLog();
      while (!completeAppend(log) && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        log = readLaunchLog();
      }
      // A launch decision can still be held before admission, leaving the log untouched.
      assert.ok(log === before || completeAppend(log), 'launch log append did not complete');
    }
    return r;
  };
  const bytes = (path: string) => existsSync(path) ? readFileSync(path, "utf8") : "absent";
  return { home, root, dir, fake, env, runtime, snapshot, data, save, key, record, manifest, pass, bytes, node, assessment: (iid = 7) => readAssessment(dir, key(iid))! };
}

