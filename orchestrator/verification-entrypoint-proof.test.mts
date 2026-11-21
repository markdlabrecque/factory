// Eligibility, claim and proof-freshness regressions share the normal-entrypoint fixture and CI inventory.
import { test } from 'node:test';
import { normalEntrypointFixture } from './verification-entrypoint-fixture.mts';

test('normal entrypoint independently replays frozen originals and binds each evidence obligation before delivery', t => normalEntrypointFixture(t,'acceptance-replay-pass','openai'));
test('normal entrypoint refuses to push when all criterion IDs pass but obligation evidence is omitted', t => normalEntrypointFixture(t, 'acceptance-obligation-omitted', 'openai'));
test('normal entrypoint refuses to push when a verifier assessment has no matching independent manual evidence', t => normalEntrypointFixture(t, 'acceptance-manual-evidence-missing', 'openai'));

for (const scenario of ['closed', 'excluded', 'claim', 'dirty', 'branch', 'missing-baseline', 'legacy-prompt', 'acceptance-omitted-criterion', 'acceptance-missing-replay', 'acceptance-replay-unknown', 'acceptance-replay-infrastructure', 'acceptance-replay-mismatched-bundle', 'acceptance-replay-changed-candidate', 'acceptance-implementer-tamper', 'acceptance-reset-unsupported', 'config-family', 'config-setup', 'runtime-template']) {
  test(`normal entrypoint ${scenario} openai/default: only the proven tip may leave`, t => normalEntrypointFixture(t, scenario, 'openai'));
}
