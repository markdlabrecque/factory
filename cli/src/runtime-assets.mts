// Authoritative source mapping for the flat runtime and shared project scaffold files.
// Dispatch, recovery triage and preparation, supervisor workflows, delivery proof and repair ship as one complete inventory.
export const FROM_ORCHESTRATOR = ['recovery-analysis.mts', 'recovery-analysis-contract.mts', 'recovery-triage.mts', 'recovery-triage-contract.mts', 'dependencies.mts', 'dispatch.mts', 'dispatch.sh', 'refresh.mts', 'graph.mts', 'analyze.mts', 'tracker.mts', 'tracker.gitlab.mts', 'tracker.github.mts',
  'host-launch.mts', 'launch-readiness.mts', 'readiness-identity.mts', 'ticket-context.mts', 'ticket-context-source.mts', 'ticket-input.mts', 'ticket-input-evidence.mts', 'delivery-followup.mts', 'verification.mts', 'readiness.mts', 'readiness-schema.mts', 'no-commit.mts', 'sandbox-readiness.mts', 'payload-custody.mts',
  'capabilities.mts', 'ci.mts', 'models.mts', 'model-policy.mts', 'manifests.mts', 'preflight.mts', 'prompt.analyze.md', 'prompt.recover.md', 'prompt.triage.md', 'handoff.mts',
  'workflow.mts', 'context.mts', 'instructions.mts', 'context-process.mts', 'recovery.mts', 'recovery-sandbox.mts', 'ownership.mts', 'project-config.mts', 'runtime-config.mts', 'config-read.mts', 'selection.mts',
  'project-layout.mts', 'supervisor-contract.mts', 'supervisor-policy.mts', 'supervisor.mts', 'prompt.supervisor.md', 'gate-review.mts', 'prompt.gate-review.md',
  ...['index.js','date.js','error.js','extract.js','parse.js','primitive.js','stringify.js','struct.js','util.js','package.json','LICENSE','UPSTREAM.md'].map(n => `vendor/smol-toml/${n}`)];
// journal.mts is a mandatory board projection import, including in project dispatcher copies.
export const FROM_BOARD = ['execution-events.mts', 'delivery.mts', 'board.mts', 'admission.mts', 'assessment.mts', 'journal.mts', 'readiness-view.mts', 'board.template.html'];

import { isAbsolute, posix } from 'node:path';

export type RuntimeAsset = { source: string; destination: string };
export const RUNTIME_INVENTORY_VERSION = 1;
export const RUNTIME_ASSETS: readonly RuntimeAsset[] = Object.freeze([
  ...FROM_ORCHESTRATOR.map(name => ({ source: `orchestrator/${name}`, destination: name })),
  ...FROM_BOARD.map(name => ({ source: `board/${name}`, destination: name })),
  { source: 'board/supervisor.mts', destination: 'supervisor-view.mts' },
  // The flat runtime keeps the probe entrypoint and board store under distinct names.
  { source: 'board/readiness.mts', destination: 'readiness-store.mts' },
  ...['runtime-assets.mts', 'runtime-bundle.mts', 'runtime-ownership.mts', 'supervisor-runtime.mts', 'supervisor-host.mts', 'supervisor-auth.mts', 'project-registry.mts', 'scheduling-observation.mts', 'supervisor-input.mts', 'supervisor-facts.mts', 'supervisor-state.mts', 'supervisor-admission.mts', 'supervisor-advisory-contract.mts', 'supervisor-openai-request.mts', 'supervisor-openai-usage.mts', 'supervisor-openai.mts', 'supervisor-process.mts', 'supervisor-runner.mts', 'supervisor-guard.mjs', 'supervisor-host-policy.mts', 'supervisor-rollout.mts', 'supervisor-worker.mts', 'supervisor-schedule.mts', 'supervisor-review.mts', 'supervisor-escalation.mts', 'supervisor-gate-apply.mts', 'sandcastle-patch.mts', 'sandcastle-patch.json'].map(name => ({ source: `cli/src/${name}`, destination: name })),
  ...['manifest.json', 'package.json', 'package-lock.json', 'pi-ai-1.5.2.tgz', 'pi-telemetry-1.5.2.tgz', 'openai-7.19.0.tgz', 'partial-json-0.1.7.tgz']
    .map(name => ({ source: `cli/src/supervisor-provider/${name}`, destination: `supervisor-provider/${name}` })),
  // Host broker and pure paid-call preflight have distinct flat names; never overwrite either asset.
  { source: 'cli/src/supervisor-policy.mts', destination: 'supervisor-broker.mts' },
  { source: 'orchestrator/main.mts', destination: 'main.mts' },
  ...['prompt.md', 'prompt.verify.md'].map(name => ({ source: `cli/templates/project/${name}`, destination: name })),
  { source: 'package.json', destination: 'package.json' },
  { source: 'package-lock.json', destination: 'package-lock.json' },
].map(asset => Object.freeze(asset)));

export function validateRelativePath(path: string): void {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(p => !p || p === '.' || p === '..') || posix.normalize(path) !== path)
    throw new Error(`Invalid runtime relative path: ${String(path)}`);
}

export function validateRuntimeInventory(assets: readonly RuntimeAsset[]): void {
  const destinations = new Set<string>();
  for (const { source, destination } of assets) {
    validateRelativePath(source); validateRelativePath(destination);
    if (destination === 'runtime-manifest.json' || destination === 'node_modules' || destination.startsWith('node_modules/')) throw new Error(`Reserved runtime destination: ${destination}`);
    if (destinations.has(destination)) throw new Error(`Duplicate runtime destination: ${destination}`);
    destinations.add(destination);
  }
  for (const destination of destinations) {
    const parts = destination.split('/');
    while (parts.length > 1) { parts.pop(); if (destinations.has(parts.join('/'))) throw new Error(`Runtime destination collision: ${destination}`); }
  }
}
