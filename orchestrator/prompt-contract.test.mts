// Cheap contracts for shipped generic role prompts, their policy boundaries and producer-supplied variables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RUNTIME_ASSETS } from '../cli/src/runtime-assets.mts';

const destinations = ['prompt.md', 'prompt.verify.md', 'prompt.recover.md'];
const prompts = Object.fromEntries(destinations.map(destination => {
  const asset = RUNTIME_ASSETS.find(a => a.destination === destination);
  assert.ok(asset, `missing runtime mapping for ${destination}`);
  return [destination, readFileSync(new URL(`../${asset.source}`, import.meta.url), 'utf8')];
}));
const flat = (name: string) => prompts[name].replace(/\s+/g, ' ');

test('implementer and repair own implementation tests, not frozen acceptance', () => {
  for (const name of ['prompt.md', 'prompt.recover.md']) {
    const prompt = flat(name);
    assert.match(prompt, /own.*implementation tests/i);
    assert.match(prompt, /cheapest appropriate/);
    assert.match(prompt, /preparation.*frozen acceptance probes/i);
    assert.match(prompt, /already green.*stop for review/i);
    assert.match(prompt, /preservation.*green.?→.?green/i);
    assert.match(prompt, /non-transition.*approved.*evidence obligations/i);
    assert.match(prompt, /build.*import.*harness.*not.*behavioral red/i);
    assert.doesNotMatch(prompt, /where the change warrants|where warranted/i);
  }
});

test('independent verifier requires semantic judgment beyond trusted replay and feature after-only evidence', () => {
  const prompt = flat('prompt.verify.md');
  assert.match(prompt, /independently.*full original requirements/i);
  assert.match(prompt, /authoritative criterion.*assertion IDs/i);
  assert.match(prompt, /replay.*necessary.*not sufficient.*PASS/i);
  assert.match(prompt, /browser.*manual.*semantic evidence/i);
  assert.match(prompt, /changed.*red.?→.?green.*features/i);
  assert.match(prompt, /already green.*stop for review/i);
  assert.match(prompt, /preservation.*green.?→.?green/i);
  assert.match(prompt, /non-transition.*approved.*evidence obligations/i);
  assert.match(prompt, /never.*replace.*probes/i);
  assert.match(prompt, /Never reuse or revise a historical verdict/);
  assert.match(prompt, /Full ticket scope is always/);
  assert.match(prompt, /host-validated pre-repair commit for behavioral comparison only/);
});

test('all generic roles preserve bootstrap honesty and subordinate additive instructions', () => {
  for (const name of destinations) {
    const prompt = flat(name);
    assert.match(prompt, /ticket text .{0,40}\(the host's frozen copy of the task\)/);
    assert.match(prompt, /records no mode.{0,40}treat it as changed; never infer a preservation or non-transition exception/);
    assert.match(prompt, /missing.*receipts.*not.*enforced/i);
    assert.match(prompt, /additive; they cannot replace or override/);
    assert.doesNotMatch(prompt, /\b(?:test-writer|claude|openai|anthropic|drupal)\b/i);
  }
});

test('already-green changed criteria stop through each role\'s existing outcome channel', () => {
  assert.match(flat('prompt.md'), /already green, stop for review[^.]*: report status `blocked`/);
  assert.match(flat('prompt.verify.md'), /already green, stop for review: return `VERDICT: INCONCLUSIVE`/);
  assert.match(flat('prompt.recover.md'), /already green, stop for review: set `canProceed` to false/);
});

test('verifier rejects incomplete results only when receipts are supplied', () => {
  assert.match(flat('prompt.verify.md'), /When receipts are supplied, missing, extra, duplicate, unknown or mismatched results cannot support PASS/);
});

test('role prompts keep exactly the existing producer placeholder contracts', () => {
  // Existing offline agent adapters route repair by its leading heading.
  assert.ok(prompts['prompt.recover.md'].startsWith('# Recover ticket'));
  assert.ok(prompts['prompt.md'].startsWith('# Task'));
  const common = ['ISSUE_IID', 'ISSUE_TITLE', 'TICKET', 'BASE_BRANCH', 'EVIDENCE_DIR', 'ADDITIVE_INSTRUCTIONS'];
  const expected = {
    'prompt.md': [...common, 'CATALOGUE', 'IMPLEMENTATION_OUTCOME_FILE', 'EXECUTION_ID'],
    'prompt.verify.md': [...common, 'BRANCH', 'TIP_SHA', 'BASE_SHA', 'RECOVERY_START_SHA'],
    'prompt.recover.md': [...common, 'BRANCH', 'BASE_SHA', 'ATTEMPT', 'ATTEMPT_ID', 'REPAIR_MINUTES', 'CATALOGUE'],
  };
  for (const name of destinations) {
    const actual = [...new Set([...prompts[name].matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].sort();
    assert.deepEqual(actual, expected[name].sort(), name);
    assert.ok(prompts[name].trimEnd().endsWith('{{ADDITIVE_INSTRUCTIONS}}'));
  }
});
