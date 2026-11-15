// Diagnostics use captured-session fixtures and local entrypoint children, never live SDK/trackers/containers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnostic, diagnosticText, finalReply, MAX_SESSION_BYTES, sanitizeReply, saveDiagnostic } from './no-commit.mts';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

for (const scenario of ['no-commit-context', 'no-commit-unavailable', 'no-commit-dirty', 'no-commit-cleanup-error', 'no-commit-unknown-worktree', 'no-commit-blocked', 'no-commit-malformed-report', 'no-commit-stale', 'no-commit-unconfirmed-cleanup', 'primary-cleanup-error']) {
  test(scenario, t => normalEntrypointFixture(t, scenario, 'openai'));
}
const row = (text: string, stopReason = 'stop') => JSON.stringify({type:'message',message:{role:'assistant',stopReason,content:[{type:'text',text}]}});
test('bounded Pi session capture does not invent finalMessage or infer arbitrary stdout/log causes', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-reply-')); t.after(() => rmSync(root, {recursive:true,force:true}));
  const file = join(root, 'session.jsonl');
  const result = {iterations:[{sessionFilePath:file}], stdout:'EACCES guessed cause', finalMessage:'invented'};
  for (const text of ['', '{', 'x'.repeat(MAX_SESSION_BYTES + 1), row('tool work', 'toolUse'), row('failure', 'error'), row('earlier') + '\n' + JSON.stringify({type:'message',message:{role:'toolResult'}})]) {
    writeFileSync(file, text); assert.equal(finalReply(result, root), undefined);
  }
  writeFileSync(file, row('earlier') + '\n' + row('The plan in comments is unavailable. No changes made.'));
  assert.equal(finalReply(result, root), 'The plan in comments is unavailable. No changes made.');
  assert.equal(finalReply(result, join(root, 'other-execution')), undefined, 'stale execution cannot supply a reply');
  rmSync(file); symlinkSync('/dev/zero', file); assert.equal(finalReply(result, root), undefined);
  assert.equal(finalReply({}, root), undefined);
});
test('claims remain attributed, dependency reports separate, fixed bounded private evidence', t => {
  const root = mkdtempSync(join(tmpdir(), 'factory-diagnostic-')); t.after(() => rmSync(root, {recursive:true,force:true}));
  const d = diagnostic('execution', 'dirty', false, sanitizeReply('Already pushed, merged and completed! /private/path secret=fixture ghp_abcdef https://user:password@example.test'));
  const text = diagnosticText(d);
  assert.match(text, /push not-attempted/); assert.match(text, /Agent reported: "Already pushed/);
  assert.match(text, /not verified success/); assert.match(text, /dependency report missing/);
  assert.ok(!text.includes('/private/path') && !text.includes('fixture') && !text.includes('ghp_abcdef') && !text.includes('user:password'));
  assert.match(diagnosticText(diagnostic('execution', 'unknown', true)), /dependency policy only/);
  assert.match(diagnosticText(diagnostic('execution', 'unknown', false)), /cause unknown/);
  assert.match(diagnosticText(d, false), /Evidence: diagnostic unavailable/);
  assert.ok(!diagnosticText(d, false).includes('execution/no-commit.json'));
  assert.equal(sanitizeReply('a'.repeat(9000)).length, 4096);
  assert.equal(diagnostic('execution', 'unknown', false, undefined, '/private/arbitrary.log').logReference, 'unavailable');
  assert.equal(diagnostic('execution', 'unknown', false, undefined, '.sandcastle/logs/implementer.log').logReference, '.sandcastle/logs/implementer.log');
  saveDiagnostic(root, d); assert.deepEqual(JSON.parse(readFileSync(join(root,'no-commit.json'),'utf8')), d);
  assert.throws(() => saveDiagnostic(root, d), /EEXIST/);
});
