// `factory ticket comment` and `factory ticket sync` tests (#99, #100): the comment is saved in the ticket journal first and kept whatever the post does;
// the post goes through the project's tracker CLI (`gh api` / `glab api`) with the event's marker, and its outcome is
// recorded as delivered, pending (the CLI never ran) or uncertain (it ran and failed); sync delivers what is left, and
// searches for an uncertain event's marker before posting so nothing is posted twice. Disposable HOME, project and state
// folder; the tracker CLI is an injected fake, or a test-owned `gh` stub first on PATH for the end-to-end run. No tracker.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addComment, beginDelivery, finishDelivery, markerFor, readJournal } from '../../board/journal.mts';
import { paths } from '../src/paths.mts';
import { addProject } from '../src/projects.mts';
import { ticketComment, ticketSync } from '../src/commands/ticket.mts';
import type { Exec } from '../src/commands/ticket.mts';

const GITHUB = 'export const TRACKER = {\n  kind: "github" as "gitlab" | "github",\n  host: "github.com",\n  project: "me/site",\n};\n';
const GITLAB = 'export const TRACKER = {\n  kind: "gitlab" as "gitlab" | "github",\n  gitlabHost: "git.example.com",\n  project: "group/site",\n  projectId: 7,\n};\n';

function fixture(t: TestContext, config = GITHUB) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'factory-ticket-')));
  const saved = process.env.SANDCASTLE_STATE_DIR;
  delete process.env.SANDCASTLE_STATE_DIR;
  t.after(() => { rmSync(home, { recursive: true, force: true }); if (saved === undefined) delete process.env.SANDCASTLE_STATE_DIR; else process.env.SANDCASTLE_STATE_DIR = saved; });
  const p = paths(home);
  const root = join(home, 'site');
  mkdirSync(join(root, '.sandcastle'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.sandcastle/config.mts'), config);
  addProject(p, realpathSync(root));
  mkdirSync(p.state, { recursive: true });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  return { home, p, root };
}
const journal = (p: ReturnType<typeof paths>, project: string, iid: string) => readJournal(p.state, { project, iid }).events;

test('saves the comment, posts it with its marker through gh, and records the tracker comment id', t => {
  const { p, root } = fixture(t);
  const startedAt = '2026-11-01T00:00:00.000Z';
  writeFileSync(join(p.state, 'me_site--12.json'), JSON.stringify({ iid: '12', project: 'me/site', stage: 'done', startedAt, stageSince: startedAt, updatedAt: startedAt, pid: 1 }));
  const calls: [string, string[]][] = [];
  const exec: Exec = (cmd, args) => { calls.push([cmd, args]); return { status: 0, stdout: JSON.stringify({ id: 991, html_url: 'https://github.com/me/site/issues/12#issuecomment-991' }), stderr: '' }; };
  assert.equal(ticketComment(p, '#12', ['Looks', 'right', 'to me'], { cwd: root, exec, actor: 'mark' }), 0);
  const [e] = journal(p, 'me/site', '12');
  assert.equal(e.text, 'Looks right to me');
  assert.equal(e.actor, 'mark');
  assert.equal(e.run, `started:${startedAt}`);
  assert.equal(e.delivery?.state, 'delivered');
  assert.equal(e.delivery?.remoteId, '991');
  assert.deepEqual(calls, [['gh', ['api', '--hostname', 'github.com', '-X', 'POST', 'repos/me/site/issues/12/comments', '-f', `body=Looks right to me\n\n${markerFor(e.id)}`]]]);
});

test('posts on GitLab through glab api to the encoded project path and host', t => {
  const { p, root } = fixture(t, GITLAB);
  const calls: [string, string[]][] = [];
  const exec: Exec = (cmd, args) => { calls.push([cmd, args]); return { status: 0, stdout: '{"id":5}', stderr: '' }; };
  assert.equal(ticketComment(p, '3', ['hi'], { cwd: root, exec, actor: 'a' }), 0);
  const [e] = journal(p, 'group/site', '3');
  assert.equal(e.run, undefined); // no run record: the comment still saves
  assert.deepEqual(calls[0], ['glab', ['api', '--hostname', 'git.example.com', '-X', 'POST', 'projects/group%2Fsite/issues/3/notes', '-f', `body=hi\n\n${markerFor(e.id)}`]]);
});

test('keeps the comment when the post fails: pending if the CLI never ran, uncertain if it ran and failed', t => {
  const { p, root } = fixture(t);
  const missing: Exec = () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) });
  assert.equal(ticketComment(p, '4', ['one'], { cwd: root, exec: missing, actor: 'a' }), 1);
  const failed: Exec = () => ({ status: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' });
  assert.equal(ticketComment(p, '4', ['two'], { cwd: root, exec: failed, actor: 'a' }), 1);
  const [one, two] = journal(p, 'me/site', '4');
  assert.equal(one.text, 'one');
  assert.equal(one.delivery?.state, 'pending');
  assert.equal(one.delivery?.attempts, 1);
  assert.equal(two.delivery?.state, 'uncertain');
  assert.match(two.delivery?.lastError ?? '', /502/);
});

test('refuses an empty comment and a bad ticket without writing anything', t => {
  const { p, root } = fixture(t);
  const exec: Exec = () => assert.fail('nothing to post');
  assert.throws(() => ticketComment(p, '4', ['  '], { cwd: root, exec }), /comment text/);
  assert.throws(() => ticketComment(p, 'x4', ['hi'], { cwd: root, exec }), /ticket number/);
  assert.deepEqual(journal(p, 'me/site', '4'), []);
});

test('the factory CLI saves and posts through the gh on PATH', t => {
  const { home, p, root } = fixture(t);
  const bin = join(home, 'bin');
  mkdirSync(bin);
  const log = join(home, 'gh-calls.jsonl');
  // Test-owned gh stub: accepts only the comment-creating API call and answers like the GitHub API.
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2);
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (a[0] !== 'api' || a[4] !== 'POST' || a[5] !== 'repos/me/site/issues/8/comments') { console.error('rejected'); process.exit(64); }
console.log(JSON.stringify({ id: 42, html_url: 'https://github.com/me/site/issues/8#issuecomment-42' }));
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const cli = resolve(import.meta.dirname, '../bin/factory.mts');
  const r = spawnSync(process.execPath, [cli, 'ticket', 'comment', '8', 'Merged by hand', '--project', 'site'],
    { cwd: home, encoding: 'utf8', env: { ...process.env, FACTORY_HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Posted to me\/site#8: https:\/\/github.com\/me\/site\/issues\/8#issuecomment-42/);
  const [e] = journal(p, 'me/site', '8');
  assert.equal(e.delivery?.remoteId, '42');
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});

/** An event whose earlier post failed: pending (`uncertain` false) or uncertain (it may have posted). */
function failed(p: ReturnType<typeof paths>, iid: string, text: string, uncertain: boolean, project = 'me/site') {
  const t = { project, iid };
  const e = addComment(p.state, t, { text, actor: 'a' });
  const s = beginDelivery(p.state, t, e.id);
  assert.ok(s.ok);
  finishDelivery(p.state, t, e.id, s.token, { error: 'HTTP 502', uncertain });
  return e;
}

test('sync finds an uncertain post by its marker and records it without posting again', t => {
  const { p, root } = fixture(t);
  const e = failed(p, '5', 'maybe posted', true);
  const calls: string[][] = [];
  // Two pages, as `gh api --paginate` prints them; the marker is on the second.
  const exec: Exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes('POST')) assert.fail('must not post a comment that is already on the tracker');
    return { status: 0, stdout: `[{"id":1,"body":"other ] text"}]\n[{"id":77,"body":"maybe posted\\n\\n${markerFor(e.id)}"}]\n`, stderr: '' };
  };
  assert.equal(ticketSync(p, undefined, { cwd: root, exec }), 0);
  assert.deepEqual(calls, [['gh', 'api', '--hostname', 'github.com', '--paginate', 'repos/me/site/issues/5/comments?per_page=100']]);
  const [after] = journal(p, 'me/site', '5');
  assert.equal(after.delivery?.state, 'delivered');
  assert.equal(after.delivery?.remoteId, '77');
});

test('sync posts pending events and unfound uncertain ones once, then has nothing left to do', t => {
  const { p, root } = fixture(t, GITLAB);
  const pend = failed(p, '2', 'never sent', false, 'group/site');
  const unsure = failed(p, '9', 'lost reply', true, 'group/site');
  failed(p, '9', 'someone else', false, 'other/site'); // another project's journal is not this project's to sync
  const posts: string[] = [];
  let lists = 0;
  const exec: Exec = (cmd, args) => {
    assert.equal(cmd, 'glab');
    if (!args.includes('POST')) { lists++; return { status: 0, stdout: '[]', stderr: '' }; }
    posts.push(args.at(-1)!);
    return { status: 0, stdout: JSON.stringify({ id: 100 + posts.length }), stderr: '' };
  };
  assert.equal(ticketSync(p, undefined, { cwd: root, exec }), 0);
  assert.equal(lists, 1); // only the uncertain event needed a search
  assert.deepEqual(posts, [`body=never sent\n\n${markerFor(pend.id)}`, `body=lost reply\n\n${markerFor(unsure.id)}`]);
  assert.equal(journal(p, 'group/site', '2')[0].delivery?.remoteId, '101');
  assert.equal(journal(p, 'other/site', '9')[0].delivery?.state, 'pending');
  assert.equal(ticketSync(p, undefined, { cwd: root, exec: () => assert.fail('nothing left to deliver') }), 0);
});

test('sync never posts an uncertain event when the marker search fails, and keeps it for the next sync', t => {
  const { p, root } = fixture(t);
  failed(p, '6', 'unsure', true);
  failed(p, '7', 'other ticket', false);
  const exec: Exec = (_cmd, args) => {
    if (args.includes('POST')) assert.fail('nothing may be posted');
    return { status: 1, stdout: '', stderr: 'HTTP 503' };
  };
  assert.equal(ticketSync(p, '#6', { cwd: root, exec }), 1); // one ticket only: #7 is not touched
  const [e] = journal(p, 'me/site', '6');
  assert.equal(e.delivery?.state, 'uncertain');
  assert.match(e.delivery?.lastError ?? '', /marker search failed.*503/);
  assert.equal(journal(p, 'me/site', '7')[0].delivery?.attempts, 1);
});
