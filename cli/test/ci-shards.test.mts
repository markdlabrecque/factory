// Check CI's exact-once inventory partition and bounded gates without running external services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = 'scripts/test-shard.sh';
const workflow = readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../../scripts/test-shard.sh', import.meta.url), 'utf8');

test('unchanged CI gates run for PRs targeting main and develop', () => {
  const targets = workflow.match(/^on:\n  pull_request:\n    branches: \[([^\]]+)\]/m);
  assert.ok(targets, 'explicit pull_request base-branch list required');
  assert.deepEqual(targets[1].split(',').map(branch => branch.trim()), ['main', 'develop']);
});

test('CI shards assign every current regular test file exactly once, including new files', () => {
  const expected = ['orchestrator', 'board', 'cli/test'].flatMap(directory =>
    readdirSync(`${root}/${directory}`).filter(name => name.endsWith('.test.mts')).map(name => `${directory}/${name}`)
  ).sort();
  const matrix = workflow.match(/shard: \[([\d, ]+)\]/);
  assert.ok(matrix);
  const indices = matrix[1].split(',').map(value => Number(value.trim()));
  assert.deepEqual(indices, [1, 2, 3, 4]);
  assert.match(workflow, /run: bash scripts\/test-shard\.sh \$\{\{ matrix.shard \}\} 4/);
  const assigned = indices.flatMap(index => {
    const args = [script, String(index), String(indices.length), '--list'];
    const first = spawnSync('bash', args, { cwd: root, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const second = spawnSync('bash', args, { cwd: root, encoding: 'utf8' });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout, 'assignment must be deterministic');
    const files = first.stdout.trim().split('\n');
    assert.deepEqual(files, expected.filter((_, position) => position % indices.length === index - 1));
    return files;
  });
  assert.equal(new Set(assigned).size, assigned.length, 'no duplicate file');
  assert.deepEqual(assigned.sort(), expected, 'no missing or extra file');
  assert.ok(assigned.includes('orchestrator/browser-provisioning.test.mts'));
});

test('invalid shard requests fail before executing tests', () => {
  for (const args of [[], ['0', '4'], ['5', '4'], ['1', '0'], ['x', '4'], ['1', '4', '--skip']]) {
    const result = spawnSync('bash', [script, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, '');
  }
});

test('runner executes temporary tests and propagates assertion failures', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'factory-ci-shards-'));
  try {
    for (const directory of ['scripts', 'orchestrator', 'board', 'cli/test']) {
      mkdirSync(join(fixture, directory), { recursive: true });
    }
    writeFileSync(join(fixture, script), runner);
    for (const directory of ['orchestrator', 'board', 'cli/test']) {
      writeFileSync(join(fixture, directory, 'fixture.test.mts'),
        "import { test } from 'node:test'; test('temporary fixture passes', () => {});\n");
    }
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = () => spawnSync('bash', [join(fixture, script), '1', '1'], {
      cwd: fixture, encoding: 'utf8', timeout: 10000, env,
    });
    const passing = run();
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(passing.stdout, /# pass 3/);
    writeFileSync(join(fixture, 'board/fixture.test.mts'),
      "import { test } from 'node:test'; test('temporary fixture fails', () => { throw Error('expected failure'); });\n");
    const failing = run();
    assert.equal(failing.status, 1, failing.stderr);
    assert.match(failing.stdout, /# fail 1/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('CI bounds suite jobs and preserves the independent lifecycle check and fail-closed aggregate', () => {
  assert.match(runner, /exec timeout --signal=KILL 1200s node --test --test-concurrency=4 --test-reporter=tap --test-timeout=480000 "\$\{selected\[@\]\}"/);
  assert.match(workflow, /^  suite:\n    runs-on: ubuntu-latest\n    timeout-minutes: 25\b/m);
  assert.match(workflow, /- name: Run complete suite shard\n        timeout-minutes: 22\b/);
  assert.match(workflow, /timeout --signal=KILL 30s node --test --test-reporter=tap --test-timeout=15000 orchestrator\/browser-provisioning.test.mts/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /needs: \[browser-lifecycle, suite\]\n    if: always\(\)/);
  assert.match(workflow, /test "\$BROWSER_RESULT" = success && test "\$SUITE_RESULT" = success/);
});
