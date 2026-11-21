// Selected child and recovery entrypoint: original baseline admission, attempt-bound replay and durable charge.
import {test} from 'node:test';
import {normalEntrypointFixture} from './verification-entrypoint-fixture.mts';
import {recoveryEntrypointFixture} from './recovery-entrypoint-fixture.mts';
test('authentic prepared dispatch child independently adopts and reaches implementer and independent verifier',t=>normalEntrypointFixture(t,'pass','anthropic','mid',false,undefined,true));
for(const fault of ['revoked','late-host-revoked','child-revoked','child-binding-changed','origin-advanced','replay-unchanged'])test(`recovery original fullscope baseline: ${fault}`,t=>recoveryEntrypointFixture(t,'pass','mid',false,fault));
for (const scenario of ['replay-missing','replay-stale','replay-cleanup','replay-probe-replacement']) {
  test(`real recovery entrypoint: ${scenario}`, t => recoveryEntrypointFixture(t,scenario,'mid'));
}
