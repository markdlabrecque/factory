// Standalone Linux/macOS installer regressions (#78): run the real scripts in temporary HOMEs against strict,
// ordered systemctl/launchctl stubs, then import and serve only the copied board files. No real service is touched.
// Required journal/tickets modules are copied too, for verdict projection and shared archive validation.
// The standalone board has no cli/, so /api/timers returns no entries and hides the strip there (#121).
// Each installer is run twice to cover updates; the ephemeral HTTP child never invokes trackers or refresh commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

for (const platform of ['systemd', 'launchd']) {
  test(`${platform} standalone install and update include all board imports`, async t => {
    const home = mkdtempSync(join(tmpdir(), `board-install-${platform}-`));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const app = join(home, '.local/share/sandcastle-board');
    const domain = `gui/${process.getuid!()}`;
    const plist = join(home, 'Library/LaunchAgents/com.sandcastle.board.plist');
    const calls = platform === 'systemd' ? [
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', '--now', 'sandcastle-board.service'],
      ['systemctl', '--user', 'restart', 'sandcastle-board.service'],
    ] : [
      ['launchctl', 'bootout', `${domain}/com.sandcastle.board`],
      ['launchctl', 'bootstrap', domain, plist],
    ];
    const expected = [...calls, ...calls];
    writeFileSync(join(home, 'expected.json'), JSON.stringify(expected));
    const stub = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const home = process.env.HOME, log = path.join(home, 'calls.jsonl');
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean) : [];
const actual = [path.basename(process.argv[1]), ...process.argv.slice(2)];
fs.appendFileSync(log, JSON.stringify(actual) + '\\n');
const expected = JSON.parse(fs.readFileSync(path.join(home, 'expected.json'), 'utf8'))[calls.length];
if (JSON.stringify(actual) !== JSON.stringify(expected)) { console.error('Unexpected service call', actual); process.exit(99); }
// launchd's initial bootout reports a missing job; an update unloads the previously installed job.
if (actual[0] === 'launchctl' && calls.length === 0) process.exit(113);
`;
    // Both names are always stubbed so a wrong-platform invocation cannot fall through to the host manager.
    for (const cmd of ['systemctl', 'launchctl']) writeFileSync(join(bin, cmd), stub, { mode: 0o755 });
    const env = { ...process.env, HOME: home, FACTORY_HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      SANDCASTLE_STATE_DIR: join(home, 'state'), HOST: '127.0.0.1', PORT: '0' };
    const script = resolve(`board/install-${platform === 'systemd' ? 'service' : 'launchd'}.sh`);
    const install = () => execFileSync('bash', [script], { cwd: home, env, encoding: 'utf8' });
    install();
    const files = ['admission.mts', 'assessment.mts', 'board-server.mts', 'board.mts', 'board.template.html', 'journal.mts', 'refresh-worker.mts', 'tickets.mts'];
    assert.deepEqual(readdirSync(app).sort(), files);
    // Simulate a partial/outdated install. Updating must restore every runtime dependency too.
    for (const file of ['admission.mts', 'assessment.mts', 'journal.mts', 'refresh-worker.mts', 'tickets.mts']) rmSync(join(app, file));
    install();
    assert.deepEqual(readdirSync(app).sort(), files);
    assert.deepEqual(readFileSync(join(home, 'calls.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s)), expected);
    execFileSync(process.execPath, ['--input-type=module', '-e',
      "import { buildBoardData } from './board.mts'; if (buildBoardData('http').runs.length) process.exit(1);"], { cwd: app, env });

    const server = spawn(process.execPath, ['board-server.mts'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(async () => {
      if (server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit');
        server.kill();
        await exited;
      }
    });
    let stderr = '';
    server.stderr!.on('data', chunk => { stderr += chunk; });
    const address = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`board startup timeout: ${stderr}`)), 10_000);
      server.on('error', reject);
      server.on('exit', code => { clearTimeout(timer); reject(new Error(`board exited ${code}: ${stderr}`)); });
      server.stdout!.on('data', chunk => {
        output += chunk;
        const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    const response = await fetch(`${address}/api/runs`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).runs, []);
    const timers = await (await fetch(`${address}/api/timers`)).json();
    assert.deepEqual(timers.timers, [], 'the standalone board has no cli/, so its unavailable timer strip is hidden');
    const page = await fetch(address);
    assert.equal(page.status, 200, 'copied template renders without repository files');
    assert.match(await page.text(), /Factory/);
  });
}
