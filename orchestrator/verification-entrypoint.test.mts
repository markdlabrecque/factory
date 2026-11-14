// #150: execute scaffolded normal main with real Git and fixture-owned agent/Docker/tracker boundaries.
// No Docker daemon, credentials, browser installation, tracker or service manager is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildAssets } from '../cli/src/scaffold.mts';
import { fixtureReport } from './fixtures/verification.mts';

for (const scenario of ['pass', 'title', 'body', 'comment', 'parent', 'closed', 'excluded', 'claim', 'dirty', 'branch', 'missing-baseline', 'legacy-prompt']) {
  test(`normal entrypoint ${scenario}: only the proven tip may leave`, t => {
    const home = mkdtempSync(join(tmpdir(), 'verification-entry-'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const root = join(home, 'site'), origin = join(home, 'origin.git'), state = join(home, 'state'), fake = join(home, 'fake'), bin = join(home, 'bin');
    mkdirSync(fake); mkdirSync(bin);
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(home, 'init', '-q', '--bare', '-b', 'main', origin); git(home, 'clone', '-q', origin, root);
    git(root, 'config', 'user.name', 't'); git(root, 'config', 'user.email', 't@t');
    writeFileSync(join(root, 'app.txt'), 'before'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'init'); git(root, 'push', '-q', 'origin', 'main');
    const baseline = git(root, 'rev-parse', 'main');
    for (const f of buildAssets({ profile: 'personal', repo: 'owner/repo', image: 'img' }, state)) {
      const p = join(root, f.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content, { mode: f.mode });
    }
    const sdk = join(root, 'node_modules/@ai-hero/sandcastle');
    cpSync(join(import.meta.dirname, 'fixtures/entrypoint/sandcastle'), sdk, { recursive: true });
    writeFileSync(join(sdk, 'index.mjs'), `
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd(), scenario = process.env.SCENARIO, fake = process.env.FAKE_STATE;
const git = (cwd, args) => execFileSync('git', args, {cwd, encoding:'utf8'}).trim();
export const pi = model => ({model}); export const claudeCode = pi;
export async function createSandbox(o) {
  const worktree = join(root, '.sandcastle/worktrees', o.branch); mkdirSync(join(root, '.sandcastle/worktrees'), {recursive:true});
  git(root, ['worktree', 'add', '-b', o.branch, worktree, o.baseBranch]);
  writeFileSync(join(fake, 'live'), 'yes');
  return {worktreePath:worktree, sandboxId:'fixture-container',
    exec: async cmd => {
      if (cmd.startsWith('command -v playwright')) return {stdout:'browser preflight OK',exitCode:0};
      if (cmd === 'hostname') return {stdout:'fixture-container',exitCode:0};
      return {stdout:execFileSync('sh',['-c',cmd],{cwd:worktree,encoding:'utf8'}),exitCode:0};
    },
    run: async o => {
      const evidence = o.promptArgs.EVIDENCE_DIR.replace('/home/agent/evidence', join(root,'.sandcastle/evidence'));
      if (o.name === 'implementer') {
        writeFileSync(join(worktree,'app.txt'),'after'); git(worktree,['commit','-qam','implementation']);
        if (scenario === 'missing-baseline') rmSync(join(root,'.git/objects',${JSON.stringify(baseline.slice(0, 2))},${JSON.stringify(baseline.slice(2))}));
        return {commits:['implementation']};
      }
      writeFileSync(join(fake,'verifier-started'),'yes');
      writeFileSync(join(evidence,'verdict.md'),'VERDICT: PASS\\nSynthetic checks');
      if (scenario !== 'legacy-prompt') writeFileSync(join(evidence,'verification.json'),${JSON.stringify(JSON.stringify(fixtureReport()))});
      writeFileSync(join(evidence,'check.txt'),'Assertions passed');
      if (scenario === 'dirty') writeFileSync(join(worktree,'app.txt'),'verifier changed tracked output');
      writeFileSync(join(fake,'changed'),'yes');
      return {commits:[]};
    },
    close: async () => {
      rmSync(join(fake,'live'));
      if (scenario === 'branch') git(worktree,['reset','--hard','HEAD~1']);
      if (scenario === 'claim') {
        const p = join(process.env.SANDCASTLE_STATE_DIR,'owner_repo--7.json');
        const r = JSON.parse(readFileSync(p)); r.claim = 'another'; writeFileSync(p,JSON.stringify(r));
      }
    }
  };
}
`);
    writeFileSync(join(sdk, 'docker.mjs'), 'export const docker = o => o;');
    // The package exports its sandbox adapter from this path.
    const pkg = JSON.parse(readFileSync(join(sdk, 'package.json'), 'utf8'));
    const dockerTarget = pkg.exports['./sandboxes/docker'];
    writeFileSync(join(sdk, typeof dockerTarget === 'string' ? dockerTarget : 'docker.mjs'), 'export const docker = o => o;');
    const ghSource = readFileSync(join(import.meta.dirname, 'fixtures/entrypoint/gh.mjs'), 'utf8');
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n` + ghSource.replace("const ticket =", `const scenario = process.env.SCENARIO;
const ticket =`).replace("const out = (v)", `if (changed) {
 if (scenario === 'title') ticket.title += ' edited';
 if (scenario === 'body') ticket.body += ' edited';
 if (scenario === 'closed') ticket.state = 'CLOSED';
 if (scenario === 'excluded') ticket.labels.push({name:'needs-human'});
}
const out = (v)`).replace('parent: null,', "parent: changed && scenario === 'parent' ? {number:9} : null,").replace('out([[]]);', "out([[...(changed && scenario === 'comment' ? [{body:'Human added requirements',system:false}] : [])]]);"), { mode: 0o755 });
    writeFileSync(join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), a = process.argv.slice(2);
if (a[0] !== 'container' || a[1] !== 'inspect') process.exit(90);
if (!fs.existsSync(path.join(process.env.FAKE_STATE,'live'))) { console.error('No such container'); process.exit(1); }
console.log('sha256:'+'d'.repeat(64));
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ['.sandcastle/main.mts', '--issue', '7', '--base', 'main'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, FAKE_STATE: fake, SCENARIO: scenario, SANDCASTLE_STATE_DIR: state }, timeout: 15000,
    });
    writeFileSync(join(home, 'output.txt'), result.stdout + result.stderr);
    if (scenario === 'pass') {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const tip = git(origin, 'rev-parse', '7-fix-login');
      const run = JSON.parse(readFileSync(join(state, 'owner_repo--7.json'), 'utf8'));
      assert.equal(run.verification.tip, tip);
      assert.equal(run.implementationBaseSha, baseline);
      assert.ok(run.executionId);
    } else {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(git(origin, 'branch', '--list', '7-fix-login'), '', result.stdout + result.stderr);
      const log = readFileSync(join(fake, 'gh.jsonl'), 'utf8');
      assert.ok(!log.includes('"merge"'), result.stdout + result.stderr);
      assert.equal(existsSync(join(fake, 'verifier-started')), scenario !== 'missing-baseline', result.stdout + result.stderr);
      const reason = ({title:/Requirements changed/,body:/Requirements changed/,comment:/Requirements changed/,parent:/parent changed/,closed:/is closed/,excluded:/excluded or needs human/,claim:/claim is no longer held/,dirty:/Verifier changed the branch/,branch:/moved from verified tip/,'missing-baseline':/bad object|missing|invalid|not a valid|unable to read/i,'legacy-prompt':/verification.json/} as Record<string, RegExp>)[scenario];
      assert.match(result.stdout + result.stderr, reason);
    }
  });
}
