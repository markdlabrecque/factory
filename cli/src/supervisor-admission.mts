// Durable exclusion accepts only an exact current source-sealed normal run; opaque/foreign raw records remain held.
// Exact release requires local terminal supervisor journal closure; neither closure grants scheduler/send permission.
// Admission and supervisor journals have separate locks. No cross-store lock, provider or tracker work runs here.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AdmissionIdentity, SupervisorHold } from '../../board/admission.mts';
const flat = existsSync(new URL('./admission.mts', import.meta.url));
const { admissionConflict, claimLive, newToken, ownerOf, validAdmissionIdentity, withAdmission } = await import(flat ? './admission.mts' : '../../board/admission.mts');
const { validateRuntimeBundle } = await import('./runtime-bundle.mts');
const { readSupervisor } = await import('./supervisor-state.mts');
const { payloadRunClosed } = await import(flat ? './payload-custody.mts' : '../../orchestrator/payload-custody.mts');
const { readLayoutRecord } = await import(flat ? './ownership.mts' : '../../orchestrator/ownership.mts');

/** Resolve symlink aliases before acquiring the lock; tracker is structured, not a project display name. */
export function canonicalAdmissionProject(project: AdmissionIdentity): AdmissionIdentity {
  if (!validAdmissionIdentity(project)) throw Error('Supervisor held: project identity unknown');
  const root = realpathSync(project.root);
  const tracker = { ...project.tracker, host: project.tracker.host.toLowerCase() };
  if (tracker.project.trim() !== tracker.project || tracker.host.trim() !== tracker.host) throw Error('Supervisor held: tracker identity unknown');
  return { root, tracker };
}
export type HoldKey = Pick<SupervisorHold, 'id' | 'project' | 'invocationId' | 'fence' | 'owner'>;
const exact = (h: SupervisorHold | undefined, k: HoldKey): boolean => !!h && h.id === k.id && h.invocationId === k.invocationId
  && h.fence === k.fence && h.owner.pid === k.owner.pid && !!k.owner.start && h.owner.start === k.owner.start
  && h.project.root === k.project.root && h.project.tracker.kind === k.project.tracker.kind
  && h.project.tracker.host === k.project.tracker.host && h.project.tracker.project === k.project.tracker.project;

/** Source primitive only. Attestations are rollout prerequisites, not proof against nonparticipating code.
 * A complete compatible runtime must be selected and all older/unmanaged work quiesced before using it.
 * Conservatively require shared-store quiescence: legacy claims/run records lack canonical checkout identity. */
export function claimSupervisorHold(dir: string, o: { project: AdmissionIdentity; invocationId: string; runtimeRoot: string;
  savedRun?: { key: string; executionId: string };
  rollout: { olderRuntimesQuiesced: true; unmanagedWorkQuiesced: true } }): SupervisorHold {
  const project = canonicalAdmissionProject(o.project);
  if (!o.invocationId?.trim() || o.rollout?.olderRuntimesQuiesced !== true || o.rollout?.unmanagedWorkQuiesced !== true)
    throw Error('Supervisor held: compatible-runtime and unmanaged-work quiescence required');
  const manifest = validateRuntimeBundle(o.runtimeRoot);
  // The selected complete runtime must contain this v2 reader/writer, not merely an arbitrary old valid bundle.
  const reader = readFileSync(join(o.runtimeRoot, 'admission.mts'), 'utf8');
  const current = readFileSync(new URL(flat ? './admission.mts' : '../../board/admission.mts', import.meta.url), 'utf8');
  if (reader !== current || !manifest.files.some(f => f.path === 'supervisor-admission.mts')
    || readFileSync(join(o.runtimeRoot, 'supervisor-admission.mts'), 'utf8') !== readFileSync(new URL(import.meta.url), 'utf8'))
    throw Error('Supervisor held: selected runtime is not admission-compatible');
  if (o.savedRun) {
    // A pinned but independently rewritten/custom launcher cannot confer this source producer's authority.
    for (const asset of ['payload-custody.mts','main.mts','sandbox-readiness.mts']) {
      if (readFileSync(join(o.runtimeRoot,asset),'utf8') !== readFileSync(new URL(flat ? `./${asset}` : `../../orchestrator/${asset}`,import.meta.url),'utf8'))
        throw Error('Supervisor held: selected runtime lacks the current source payload producer');
    }
  }
  const owner = ownerOf(process.pid);
  if (!owner.start) throw Error('Supervisor held: owner start identity unknown');
  return withAdmission(dir, tx => {
    if (Object.values(tx.state.supervisorHolds).some(h => admissionConflict(h.project, project))) throw Error('Supervisor exclusion already held');
    if (Object.keys(tx.state.entries).length || Object.values(tx.state.claims).some(claimLive)
      || Object.values(tx.state.recovery).some(r => r.pending.length)) throw Error('Supervisor held: managed work or pending accounting is not quiescent');
    // Strict raw records: do not reconcile dead PIDs into apparent quiescence or silently skip corrupt records.
    let savedRunSeen = false;
    for (const name of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      let run: unknown;
      try { run = JSON.parse(readLayoutRecord(join(dir, name))); } catch { throw Error('Supervisor held: unreadable run ownership'); }
      // Source-owned immutable custody, not stages, readiness cleanup booleans or PID death.
      // Every raw record is checked; an explicit exact saved run never hides foreign/legacy records.
      if (!o.savedRun || name !== `${o.savedRun.key}.json` || !payloadRunClosed(dir, run, {
        project, ...o.savedRun, runtime: { id: manifest.id, dependencies: manifest.dependencies },
      })) throw Error('Supervisor held: active or unknown run ownership; raw record lacks definitive ownership and payload cleanup');
      savedRunSeen = true;
    }
    if (o.savedRun && !savedRunSeen) throw Error('Supervisor held: exact saved run is missing');
    const hold: SupervisorHold = { id: newToken(), project, invocationId: o.invocationId, fence: newToken(), owner, pending: [], settled: [] };
    tx.state.supervisorHolds[hold.id] = hold; tx.commit(); return structuredClone(hold);
  });
}
export function checkSupervisorHold(dir: string, key: HoldKey): boolean {
  return withAdmission(dir, tx => exact(tx.state.supervisorHolds[key.id], key));
}
/** Read durable validated closure BEFORE the separate admission lock; no nested cross-store locks.
 * Journal closure is terminal/immutable. No-send absence, booleans or caller callbacks confer authority.
 * Exact current identity is rechecked under the admission lock so stale release cannot clear a successor. */
export function releaseSupervisorHold(dir: string, key: HoldKey): { released: boolean; reason: string } {
  let settled = false;
  try {
    const s = readSupervisor(dir,key.project);
    const matches = Object.entries(s.advisory?.policies ?? {}).filter(([,p]) => p.holdId === key.id);
    if (matches.length === 1) {
      const id = matches[0][0], r = s.reservations[id], g = s.advisory!.workers[id]?.grant, v = s.advisory!.settlements?.[id];
      settled = !!v && !!g && r.state === 'finished' && v.disposition === 'local-human-required'
        && g.invocationId === key.invocationId && g.fence === key.fence && g.holdId === key.id
        && r.owner.pid === key.owner.pid && r.owner.start === key.owner.start;
    }
  } catch { /* Missing, foreign or corrupt journal is a hold, not release evidence. */ }
  return withAdmission(dir, tx => {
    const h = tx.state.supervisorHolds[key.id];
    if (!exact(h,key)) return { released:false, reason:'held: exact supervisor identity/invocation/fence/owner does not match' };
    if (!settled || h.pending.length || h.settled.length) return { released:false, reason:'held: durable final settlement authority missing; retain exclusion and charge' };
    delete tx.state.supervisorHolds[key.id]; tx.commit();
    return { released:true, reason:'released: exact durable local human-required settlement; full charge retained' };
  });
}
