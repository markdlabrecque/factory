// #150: synthetic structured evidence/provenance for isolated handoff and entrypoint fixtures.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export const fixtureReport = (verdict = 'PASS', artifacts = [{ path: 'check.txt', kind: 'command-output', phase: 'check' }]) => ({
  version: 1, verdict, changeKind: 'feature', evidenceKind: 'command', interactive: false,
  criteria: [{ requirement: 'Fixture assertions', result: verdict.toLowerCase(), evidence: ['check.txt'] }],
  artifacts, limitations: ['Synthetic boundary only.'],
});
export const fixtureProvenance = { imageId: 'sha256:' + 'd'.repeat(64), nodeVersion: 'v22.23.4', code: {}, settings: {} };
export function writeVerification(dir: string, verdict = 'PASS') {
  writeFileSync(join(dir, 'verification.json'), JSON.stringify(fixtureReport(verdict)));
  writeFileSync(join(dir, 'check.txt'), 'fixture assertions\n');
}
export const verificationCommand = (verdict = 'PASS') => `printf '%s' '${JSON.stringify(fixtureReport(verdict))}' > "$EVIDENCE/verification.json" && echo checked > "$EVIDENCE/check.txt"`;
