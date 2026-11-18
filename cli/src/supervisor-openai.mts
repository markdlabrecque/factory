// Trusted source factory for the fixed owned Pi/OpenAI boundary. No public host/admission wiring, settlement, refund or replay authority.
import { existsSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeBundle } from './runtime-bundle.mts';
import { startOwnedProcess, readOwnedProcess, confirmOwnedCleanup } from './supervisor-process.mts';
import type { OwnedProcess } from './supervisor-process.mts';
import { validateDiagnosisGrant, advisoryDemand, advisoryReservation, ADVISORY_PROFILE, ADVISORY_PROFILE_ID } from './supervisor-advisory-contract.mts';
import type { DiagnosisGrant } from './supervisor-advisory-contract.mts';
import { readSupervisor } from './supervisor-state.mts';
import type { AdvisoryControls, AdvisoryRegistration } from './supervisor-state.mts';
import { providerResources } from './supervisor-openai-usage.mts';
import { validateAdvisoryInput } from './supervisor-openai-request.mts';
import type { AdvisoryRequest } from './supervisor-openai-request.mts';
const { supervisorHash } = await import(existsSync(new URL('./supervisor-contract.mts', import.meta.url)) ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export type OpenAIDiagnosisBoundary = {
  readonly kind: 'owned-openai'; readonly model: 'openai/gpt-6.1-terra'; readonly reservation: ReturnType<typeof advisoryReservation>;
  start(o: { project: DiagnosisGrant['project']; invocationId: string; fence: string; deadline: string; maxOutputBytes: number }): Promise<{
    process: OwnedProcess;
    /** Caller first registers a grant for process.evidence.worker in the actual journal. No callback can assert permission. */
    handoff(o: { grant: DiagnosisGrant; snapshot: AdvisoryRequest['snapshot']; policy: AdvisoryRegistration; controls: AdvisoryControls; apiKey: string }, observe?: () => Promise<import('./supervisor-openai-request.mts').AdvisoryObservation>): void;
    terminate(): Promise<boolean>; usage(): ReturnType<typeof providerResources>;
  }>;
};
/** Exact selected flat runtime only. Project TOML/model text cannot construct this capability or supply its executable/HTTP transport. */
export function createOpenAIDiagnosisBoundary(o: { runtimeRoot: string; stateDir: string; profile?: string }): OpenAIDiagnosisBoundary {
  const runtimeRoot = realpathSync(o.runtimeRoot), stateDir = realpathSync(o.stateDir);
  advisoryDemand(runtimeRoot === o.runtimeRoot && stateDir === o.stateDir && runtimeRoot === dirname(fileURLToPath(import.meta.url)), 'exact selected flat adapter required');
  const manifest = validateRuntimeBundle(runtimeRoot), profile = o.profile ?? ADVISORY_PROFILE_ID;
  return Object.freeze({ kind: 'owned-openai' as const, model: 'openai/gpt-6.1-terra' as const, reservation: Object.freeze(advisoryReservation(profile)),
    async start(input) {
      input = structuredClone(input);
      advisoryDemand(Number.isSafeInteger(input.maxOutputBytes) && input.maxOutputBytes > 0 && input.maxOutputBytes <= 1_000_000, 'bounded output required');
      const selected = validateRuntimeBundle(runtimeRoot);
      advisoryDemand(selected.id === manifest.id && selected.dependencies === manifest.dependencies, 'selected runtime changed');
      const cwd = mkdtempSync(join(tmpdir(),'factory-advisory-owned-'));
      let owned: OwnedProcess;
      try { owned = await startOwnedProcess({ ...input, runtimeRoot, stateDir, cwd, runtime: manifest.id, dependencies: manifest.dependencies }); }
      catch (e) { rmSync(cwd,{ recursive: true, force: true }); throw e; }
      let grant: DiagnosisGrant | undefined, handed = false, termination: Promise<boolean> | undefined;
      return { process: owned, handoff(request, observe) {
        advisoryDemand(!handed, 'handoff consumed'); handed = true;
        const copy = structuredClone(request), g = validateDiagnosisGrant(copy.grant);
        advisoryDemand(supervisorHash(readOwnedProcess(stateDir,g)) === supervisorHash(owned.evidence)
          && g.invocationId === input.invocationId && g.fence === input.fence && supervisorHash(g.project) === supervisorHash(input.project), 'original owned process association required');
        validateAdvisoryInput(copy.snapshot,g);
        const s = readSupervisor(stateDir,g.project), key = supervisorHash(g.invocationId);
        advisoryDemand(s.advisory?.workers[key]?.grant.id === g.id && !s.advisory?.sends[key]
          && g.profile === profile && g.runtime === manifest.id && g.dependencies === manifest.dependencies
          && g.owner.pid === owned.evidence.worker.pid && g.owner.start === owned.evidence.worker.start
          && g.deadline === input.deadline && ADVISORY_PROFILE.thinking === 'high', 'registered exact grant required before handoff');
        grant = g;
        owned.handoff({ ...copy, runtimeRoot, stateDir }, observe);
      }, terminate() {
        return termination ??= (async () => {
          const absent = await owned.terminate();
          // No grant or private metadata means no durable cleanup claim, even if this endpoint observed exit.
          const confirmed = absent && !!grant && confirmOwnedCleanup(stateDir,grant);
          if (confirmed) rmSync(cwd,{ recursive: true, force: true });
          return confirmed;
        })();
      }, usage() {
        if (!grant) return null;
        try {
          const a = readSupervisor(stateDir,grant.project).advisory?.sends[supervisorHash(grant.invocationId)];
          return a ? providerResources(stateDir,grant,a) : null;
        } catch { return null; }
      } };
    } });
}
