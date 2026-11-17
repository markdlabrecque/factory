// Trusted advisory runtime composition: validate closed source/artifacts before selected imports,
// pin host + selected identities, transfer the real ready child and retain until durable human-only closure.
// This supplies no public activation, quiescence/mount authority, auth discovery, send permission or advice.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { RUNTIME_ASSETS } from './runtime-assets.mts';
import { validateRuntimeBundle } from './runtime-bundle.mts';
import { acquireAdvisoryRuntimeLease, transferAdvisoryRuntimeLease, releaseAdvisoryRuntimeLease, assertAdvisoryRuntimeLease } from './runtime-ownership.mts';
import { verifyPinnedProvider } from './supervisor-openai-request.mts';
import { ADVISORY_PROFILE_ID } from './supervisor-advisory-contract.mts';
import type { Paths } from './paths.mts';
import type { OpenAIDiagnosisBoundary } from './supervisor-openai.mts';
const flat = existsSync(new URL('./admission.mts', import.meta.url));
const { resolveWorkflow } = await import(flat ? './workflow.mts' : '../../orchestrator/workflow.mts');
const trustedRoot = dirname(fileURLToPath(import.meta.url));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** A self-regenerated manifest, ABI name or shim boolean is not source authority.
 * First supported closure is byte-compatible complete copies only. Other complete overrides
 * remain supported by normal Factory, but advisory holds them without importing their JS. */
export function assertAdvisoryRuntimeSource(root: string) {
  const manifest = validateRuntimeBundle(root);
  for (const asset of RUNTIME_ASSETS) {
    const trusted = flat ? join(trustedRoot,asset.destination) : join(trustedRoot,'../..',asset.source);
    const actual = manifest.files.find(f => f.path === asset.destination);
    if (!actual || actual.sha256 !== sha(readFileSync(trusted))) throw Error(`Advisory held: unsupported runtime source ${asset.destination}`);
  }
  return manifest;
}
/** Explicit trusted host API; no project/environment callback can assert an installed boundary.
 * The caller still owes actual rollout isolation/control prerequisites before any public composition. */
export async function createSupervisorRuntime(o: { paths: Paths; projectRoot: string; stateDir: string; invocationId: string; fence: string }) {
  o = structuredClone(o);
  const projectRoot = realpathSync(o.projectRoot), stateDir = realpathSync(o.stateDir);
  if (projectRoot !== o.projectRoot || stateDir !== o.stateDir || !o.invocationId || !o.fence) throw Error('Advisory held: canonical explicit invocation required');
  const workflow = resolveWorkflow(projectRoot,o.paths.runtimeDescriptor,undefined,stateDir);
  const hostRoot = workflow.env.FACTORY_HOST_RUNTIME_ROOT;
  const host = assertAdvisoryRuntimeSource(hostRoot), selected = assertAdvisoryRuntimeSource(workflow.root);
  const tracker = workflow.config.TRACKER;
  const project = { root: projectRoot, tracker: { kind: tracker.kind, host: tracker.gitlabHost ?? tracker.host!, project: tracker.project } };
  // Positive actual pinned SDK/dependency closure, not the ordinary install fixture's node_modules.
  // This uses the request path's digest-verified four archives and public subpath loader; no HTTP.
  await verifyPinnedProvider(workflow.root);
  const pins = [{root:hostRoot,id:host.id,dependencies:host.dependencies}];
  if (workflow.root !== hostRoot) pins.push({root:workflow.root,id:selected.id,dependencies:selected.dependencies});
  let lease = acquireAdvisoryRuntimeLease(o.paths,host.id,{stateDir,project,invocationId:o.invocationId,fence:o.fence,profile:ADVISORY_PROFILE_ID,pins});
  const assertCurrent = () => {
    assertAdvisoryRuntimeLease(o.paths,lease);
    const now = resolveWorkflow(projectRoot,o.paths.runtimeDescriptor,undefined,stateDir);
    if (now.root !== workflow.root || now.id !== selected.id || now.manifest.dependencies !== selected.dependencies
      || now.env.FACTORY_HOST_RUNTIME_ROOT !== hostRoot || now.env.FACTORY_HOST_RUNTIME_ID !== host.id
      || now.env.FACTORY_HOST_RUNTIME_DEPENDENCIES !== host.dependencies) throw Error('Advisory held: runtime reselection');
    assertAdvisoryRuntimeSource(hostRoot); assertAdvisoryRuntimeSource(workflow.root);
  };
  assertCurrent();
  // Only after trusted source and artifact closure validation may selected JavaScript execute.
  const { loadExecutionContext } = await import(pathToFileURL(join(workflow.root,'context.mts')).href);
  const context = await loadExecutionContext({cwd:projectRoot,moduleRoot:workflow.root,env:{...workflow.env,SANDCASTLE_STATE_DIR:stateDir}});
  const adapter = await import(pathToFileURL(join(workflow.root,'supervisor-openai.mts')).href);
  const owned: OpenAIDiagnosisBoundary = adapter.createOpenAIDiagnosisBoundary({runtimeRoot:workflow.root,stateDir});
  let started = false;
  const boundary: OpenAIDiagnosisBoundary = Object.freeze({kind:owned.kind,model:owned.model,reservation:owned.reservation,
    async start(input) {
      if (started || input.invocationId !== o.invocationId || input.fence !== o.fence || JSON.stringify(input.project) !== JSON.stringify(project)) throw Error('Advisory held: pinned invocation mismatch or already started');
      started = true; assertCurrent(); context.assertCurrent({strictOriginals:true});
      const handle = await owned.start(input);
      // Pins exist before start. A failed/uncertain transfer retains them, even after child cleanup.
      try { lease = await transferAdvisoryRuntimeLease(o.paths,lease,handle.process.evidence); }
      catch (error) { await handle.terminate(); throw error; }
      return {...handle,handoff(request, observe) {
        if (typeof observe !== 'function') throw Error('Advisory held: pinned host requires fresh IPC observations');
        assertCurrent(); context.assertCurrent({strictOriginals:true}); handle.handoff(request, observe);
      }};
    }});
  return Object.freeze({context,boundary,identity:Object.freeze({host:host.id,hostDependencies:host.dependencies,selected:selected.id,dependencies:selected.dependencies,profile:ADVISORY_PROFILE_ID}),
    lease:() => structuredClone(lease), assertCurrent,
    release:() => releaseAdvisoryRuntimeLease(o.paths,lease)});
}
