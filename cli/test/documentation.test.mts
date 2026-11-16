// Documentation examples exercise production parsing and disposable runtime fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import { loadInstructions } from '../../orchestrator/instructions.mts';
import { resolveTicketModel } from '../../orchestrator/models.mts';
import { ROLE_TIERS, modelForRole } from '../../orchestrator/model-policy.mts';
import { resolveWorkflow } from '../../orchestrator/workflow.mts';
import { recoveryCopyProblem, recordReview } from '../src/recovery-review.mts';
import { paths } from '../src/paths.mts';
import { installedFixture } from './workflow-fixture.mts';
import { factoryToml } from './config-fixture.mts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const guides = ['README.md', 'TESTING.md', 'docs/factory-cli.md', 'docs/ticket-readiness.md', 'docs/project-config.md', 'docs/execution-context.md', 'docs/sandcastle-patch.md', 'docs/image-readiness.md', 'docs/board-design-prototype.md', 'orchestrator/ADAPTING.md', 'skills/sandcastle-setup/SKILL.md'];
const text = (file: string) => readFileSync(join(repo, file), 'utf8');
function fences(source: string, language: string) {
  return [...source.matchAll(new RegExp('^\\s*```' + language + '[^\\n]*\\n([\\s\\S]*?)^\\s*```[ \\t]*$', 'gm'))].map(m => m[1].replace(/^ {1,3}/gm, ''));
}
function temp(t: any) { const root = mkdtempSync(join(tmpdir(), 'factory-doc-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }

test('every documented TOML fence parses as a complete example or compatible fragment', t => {
  const root = temp(t), config = join(root, '.factory'); mkdirSync(config);
  let count = 0;
  for (const guide of guides) for (const snippet of fences(text(guide), 'toml')) {
    count++;
    let base = factoryToml('owner/repo');
    if (/^\[sandbox\]/m.test(snippet) && !/^version\s*=/m.test(snippet)) base = base.replace(/\[sandbox\][\s\S]*$/, '');
    const full = /^version\s*=/m.test(snippet) ? snippet : base + '\n' + snippet;
    writeFileSync(join(config, 'factory.toml'), full);
    for (const [, path] of snippet.matchAll(/"(docs\/[^"\n]+\.md)"/g)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), 'fixture instructions'); }
    const parsed = loadTomlConfig(config)!;
    if (snippet.includes('[instructions]')) for (const role of ['implementation', 'verification', 'analysis', 'recovery'] as const) loadInstructions(root, parsed.instructions, role);
    if (/kind = "gitlab"/.test(snippet)) { assert.equal(parsed.TRACKER.kind, 'gitlab'); assert.deepEqual(parsed.LABELS.ready, ['Ready to do', 'ready-for-agent']); }
    if (/kind = "github"/.test(snippet)) { assert.equal(parsed.TRACKER.kind, 'github'); assert.equal(parsed.MERGE.auto, true); assert.equal(parsed.AGENT.family, 'openai'); }
    if (/kind = "gitlab"/.test(snippet)) { assert.equal(parsed.AGENT.family, 'anthropic'); assert.equal(parsed.MERGE.auto, false); }
  }
  assert.equal(count, 9, 'new examples require fixture classification');
  for (const key of ['provider', 'model', 'thinking', 'model_aliases']) {
    writeFileSync(join(config, 'factory.toml'), factoryToml('owner/repo') + `\n[agent]\n${key} = "old"\n`);
    assert.throws(() => loadTomlConfig(config));
  }
  writeFileSync(join(config, 'factory.toml'), factoryToml('owner/repo') + '\n[graph]\nmodel = "old"\n');
  assert.throws(() => loadTomlConfig(config));
});

test('documented tiers, roles and rejected legacy declarations use production policy', () => {
  const doc = text('docs/project-config.md');
  assert.match(doc, /Both families use Pi with high thinking/);
  assert.match(doc, /analysis uses Mid, and verification and recovery use Large/);
  for (const family of ['openai', 'anthropic'] as const) {
    const row = doc.match(new RegExp('^\\| `' + family + '` \\| `([^`]+)` \\| `([^`]+)` \\| `([^`]+)` \\|$', 'm'));
    assert.ok(row, `model table row for ${family}`);
    const documented = { small: row[1], mid: row[2], large: row[3] };
    for (const role of ['implementation', 'analysis', 'verification', 'recovery'] as const) {
      for (const tier of ['small', 'mid', 'large'] as const) {
        const result = modelForRole(family, role, tier);
        const expectedTier = role === 'implementation' ? tier : role === 'analysis' ? 'mid' : 'large';
        assert.equal(result.tier, expectedTier); assert.equal(result.model, documented[expectedTier]);
        assert.equal(result.agent, 'pi'); assert.equal(result.thinking, 'high');
      }
    }
    for (const tier of ['small', 'mid', 'large'] as const) {
      const r = resolveTicketModel(`Model tier: ${tier}`, family);
      assert.equal(r.choice?.tier, tier); assert.equal(r.model, documented[tier]);
      assert.equal(resolveTicketModel(`**Model tier:** ${tier}`, family).model, documented[tier]);
    }
    assert.equal(resolveTicketModel('', family).choice?.tier, 'mid');
    for (const declaration of ['Model: openai/gpt-6.1-sol', 'Pi model: mid', 'Model tier: invalid', 'Model tier: small\nModel tier: large']) assert.notEqual(resolveTicketModel(declaration, family).status, 'resolved');
  }
  assert.deepEqual(ROLE_TIERS, { analysis: 'mid', verification: 'large', recovery: 'large' });
});

test('documented manifest command regenerates a copied fixture bundle and invalidates review', t => {
  const home = temp(t), root = join(home, 'project'), p = paths(join(home, 'home'));
  mkdirSync(join(root, '.factory'), { recursive: true }); installedFixture(p);
  const config = join(root, '.factory/factory.toml'); writeFileSync(config, factoryToml('owner/repo'));
  const original = resolveWorkflow(root, p.runtimeDescriptor);
  const override = join(root, '.factory/workflow'); cpSync(original.root, override, { recursive: true });
  const fragment = fences(text('orchestrator/ADAPTING.md'), 'toml').find(s => s.includes('[workflow]'))!;
  writeFileSync(config, factoryToml('owner/repo') + '\n' + fragment);
  recordReview(p, root); assert.equal(recoveryCopyProblem(p, root), null);
  const command = fences(text('orchestrator/ADAPTING.md'), 'sh').find(s => s.includes('regenerateRuntimeManifest'))!;
  const script = command.match(/node --input-type=module -e '([\s\S]*)'\s*$/)![1].replace('/path/to/factory/orchestrator/workflow.mts', join(repo, 'orchestrator/workflow.mts'));
  const regenerate = () => execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { PATH: '/nonexistent', HOME: home }, encoding: 'utf8' });
  writeFileSync(join(override, 'prompt.recover.md'), 'changed fixture');
  assert.ok(recoveryCopyProblem(p, root)); regenerate();
  assert.equal(resolveWorkflow(root, p.runtimeDescriptor).mode, 'project'); assert.match(recoveryCopyProblem(p, root)!, /changed since recovery review/);
  recordReview(p, root); assert.equal(recoveryCopyProblem(p, root), null);
  writeFileSync(join(override, 'node_modules/tsx/dist/cli.mjs'), 'changed fixture dependency'); regenerate();
  assert.match(recoveryCopyProblem(p, root)!, /changed since recovery review/);
});

test('README init and config explain examples run against disposable projects', t => {
  const home = temp(t), p = paths(join(home, 'home'));
  installedFixture(p);
  const cli = join(repo, 'cli/bin/factory.mts');
  const bin = join(home, 'bin'); mkdirSync(bin); symlinkSync('/usr/bin/git', join(bin, 'git'));
  const env = { FACTORY_HOME: p.home, HOME: home, PATH: bin, GIT_CONFIG_NOSYSTEM: '1' };
  const examples = fences(text('README.md'), 'sh').flatMap(s => s.split('\n')).filter(s => s.startsWith('factory init '));
  assert.equal(examples.length, 2);
  for (const [i, example] of examples.entries()) {
    const root = join(home, `project-${i}`); mkdirSync(root);
    execFileSync('/usr/bin/git', ['init', '-q', root], { env });
    const args = example.replace('/path/to/project', root).split(/\s+/).slice(1);
    execFileSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
    const c = loadTomlConfig(join(root, '.factory'));
    assert.equal(c.TRACKER.kind, i ? 'gitlab' : 'github'); assert.equal(c.MERGE.auto, !i);
    const line = fences(text('README.md'), 'sh').flatMap(s => s.split('\n')).find(s => s.startsWith('factory config explain '))!;
    const explain = line.replace('/path/to/project', root).split(/\s+/).slice(1);
    const result = JSON.parse(execFileSync(process.execPath, [cli, ...explain], { cwd: root, env, encoding: 'utf8' }));
    assert.equal(result.version, 1); assert.equal(result.policy.family, 'openai');
  }
});


// GitHub heading IDs preserve Unicode letters, numbers, spaces, underscores and hyphens.
function markdownProse(source: string) {
  return source.replace(/<!--[\s\S]*?-->/g, '').replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, '');
}
function headingIds(source: string) {
  const ids = new Set<string>(), counts = new Map<string, number>();
  for (const match of markdownProse(source).matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const heading = match[1].replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[`*_~]/g, '');
    const base = heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '').replace(/ /g, '-');
    let id = base, n = counts.get(base) ?? 0;
    while (ids.has(id)) id = `${base}-${++n}`;
    counts.set(base, n); ids.add(id);
  }
  return ids;
}
test('relative Markdown links and GitHub heading anchors in authoritative guides resolve', () => {
  for (const guide of guides) {
    const prose = markdownProse(text(guide)).replace(/`+[^`\n]*`+/g, '');
    for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const href = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      const [path, anchor] = href.split('#');
      const target = path ? resolve(dirname(join(repo, guide)), decodeURIComponent(path)) : join(repo, guide);
      assert.ok(existsSync(target), `${guide}: missing ${href}`);
      if (anchor) assert.ok(headingIds(readFileSync(target, 'utf8')).has(decodeURIComponent(anchor)), `${guide}: missing anchor ${href}`);
    }
  }
});
