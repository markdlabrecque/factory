// Explain data-only project configuration without executing workflow code or changing state.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Paths } from '../paths.mts';
import { readRegistry } from '../projects.mts';
import { loadTomlConfig, resolveCheckoutPath } from '../../../orchestrator/project-config.mts';
import { loadInstructions } from '../../../orchestrator/instructions.mts';
import { resolveWorkflow } from '../../../orchestrator/workflow.mts';
import { AGENT_POLICY, MODEL_POLICY, MODEL_POLICY_ID, ROLE_TIERS } from '../../../orchestrator/model-policy.mts';

function rootFor(p: Paths, project?: string, cwd = process.cwd()): string {
  const registry = readRegistry(p).projects;
  if (project) {
    const matches = registry.filter(x => x.name === project);
    if (matches.length > 1) throw Error('Ambiguous registered project name');
    if (matches.length === 1) return realpathSync(matches[0].root);
    return realpathSync(resolve(cwd, project));
  }
  const here = realpathSync(cwd);
  const matches = registry.map(x => { try { return realpathSync(x.root); } catch { return ''; } })
    .filter(root => root && (here === root || (!relative(root, here).startsWith(`..${sep}`) && relative(root, here) !== '..' && !isAbsolute(relative(root, here)))))
    .sort((a, b) => b.length - a.length);
  if (matches.length) return matches[0];
  for (let dir = here;; dir = dirname(dir)) {
    if (existsSync(join(dir, '.sandcastle', 'factory.toml'))) return dir;
    if (dirname(dir) === dir) throw Error('No project found');
  }
}

export function configExplain(p: Paths, action: string | undefined, o: { project?: string; json?: boolean; cwd?: string } = {}): number {
  if (action !== 'explain') throw Error('Usage: factory config explain [--project <name|path>] [--json]');
  let phase = 'project resolution';
  let result: Record<string, unknown> = { version: 1, errors: [], warnings: [] };
  try {
    const root = rootFor(p, o.project, o.cwd);
    result.projectRoot = root;
    phase = 'configuration';
    const configPath = resolveCheckoutPath(root, '.sandcastle/factory.toml', 'file');
    const c = loadTomlConfig(join(root, '.sandcastle'));
    result.config = { path: configPath, schema: 2, sha256: createHash('sha256').update(readFileSync(configPath)).digest('hex') };
    result.warnings = c.warnings;
    const { sandboxSetup, ...sandbox } = c.config;
    result.settings = { tracker: c.TRACKER, agent: c.AGENT, labels: c.LABELS, merge: c.MERGE, work: { units: c.SUBTASKS.enabled ? 'subtasks' : 'issues' },
      graph: c.GRAPH, selection: c.selection, dispatch: c.dispatch, ci: { waitMinutes: sandbox.ciWaitMinutes, noPipelineMinutes: sandbox.noPipelineMinutes }, sandbox: { image: sandbox.image,
        setup: { count: sandboxSetup.length, steps: sandboxSetup.map(({ sudo, timeoutMs }) => ({ sudo, timeoutMs: timeoutMs ?? 'unknown' })) } } };
    result.sources = c.sources;
    phase = 'instruction files';
    const instructions: Record<string, unknown> = {};
    for (const role of ['implementation', 'verification', 'analysis', 'recovery'] as const)
      instructions[role] = loadInstructions(root, c.instructions, role).hashes;
    result.instructions = instructions;
    phase = 'workflow runtime';
    const workflow = resolveWorkflow(root, p.runtimeDescriptor);
    result.workflow = { mode: workflow.mode, root: workflow.root, identity: workflow.id,
      manifest: { version: workflow.manifest.version, dependencies: workflow.manifest.dependencies },
      behavior: workflow.mode === 'project' ? 'opaque' : 'factory' };
    result.policy = workflow.mode === 'factory'
      ? { source: MODEL_POLICY_ID, family: c.AGENT.family, tiers: MODEL_POLICY[c.AGENT.family], implementationDefault: 'mid', roles: ROLE_TIERS, ...AGENT_POLICY }
      : { configuredFamily: c.AGENT.family, actual: 'unknown', behavior: 'opaque' };
  } catch (error) {
    // Loader errors may contain arbitrary keys or file contents. Only retain known schema keys.
    const message = error instanceof Error ? error.message : '';
    const key = phase === 'configuration' ? message.match(/: ((?:version|tracker|agent|labels|graph|sandbox|selection|work|dispatch|merge|ci|workflow|instructions)(?:\.[a-z_]+|\[\d+\])*)\: /)?.[1] : undefined;
    const safeKey = key && key.length <= 100 && /^(?:version|tracker\.(?:kind|project|host|project_id)|agent\.family|workflow\.(?:mode|directory)|instructions\.(?:common|implementation|verification|analysis|recovery)|sandbox\.(?:image|setup(?:\[\d+\](?:\.(?:command|sudo|timeout_ms))?)?))$/.test(key) ? key : undefined;
    result.errors = [{ phase, ...(phase === 'configuration' ? { file: '.sandcastle/factory.toml' } : {}), ...(safeKey ? { key: safeKey } : {}), message: `Cannot validate ${phase}; check the relevant project files and permissions.` }];
  }
  const failed = (result.errors as unknown[]).length > 0;
  if (o.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Factory configuration${failed ? ' (invalid)' : ''}\n${JSON.stringify(result, null, 2)}`);
  return failed ? 1 : 0;
}
