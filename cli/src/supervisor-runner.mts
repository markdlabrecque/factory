// Fresh tool-free provider worker. Wait for parent registration/grant handoff; final send authority remains the journal gate.
import { requestAdvisory } from './supervisor-openai-request.mts';
import { captureProviderEvidence, persistProviderUsage } from './supervisor-openai-usage.mts';
import { validateDiagnosisGrant } from './supervisor-advisory-contract.mts';
import { readSupervisor } from './supervisor-state.mts';
import { readOwnedProcess } from './supervisor-process.mts';
import { existsSync } from 'node:fs';
const { supervisorHash } = await import(existsSync(new URL('./supervisor-contract.mts', import.meta.url)) ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
if (!process.send) throw Error('Advisory held: owned IPC required');
process.once('message', async (m: any) => {
  try {
    if (m?.kind !== 'handoff') throw Error('Advisory held: explicit handoff required');
    const o = m.request, g = validateDiagnosisGrant(o.grant);
    readOwnedProcess(o.stateDir,g);
    let result: any;
    try { result = await requestAdvisory(o); }
    finally {
      // An exception after authorization is spent too. Missing terminal metadata publishes UNKNOWN, never zero.
      const a = readSupervisor(o.stateDir, g.project).advisory?.sends[supervisorHash(g.invocationId)];
      if (a) persistProviderUsage(o.stateDir, g, a, captureProviderEvidence(result));
    }
    const text = result?.result?.content?.filter((v: any) => v.type === 'text').map((v: any) => v.text).join('') ?? '';
    if (Buffer.byteLength(text) > m.maxOutputBytes) throw Error('Advisory held: output overflow');
    process.stdout.write(text, () => { process.send!({ kind: 'complete' }, () => process.exit(0)); });
  } catch { process.exit(1); }
});
process.send({ kind: 'ready' });
