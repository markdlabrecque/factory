// Approved admission seam: real recovery host charge and selected child, with owned producer evidence.
import {test} from 'node:test';
import {normalEntrypointFixture} from './verification-entrypoint-fixture.mts';
import {recoveryEntrypointFixture} from './recovery-entrypoint-fixture.mts';
test('authentic prepared dispatch child independently adopts and reaches implementer and independent verifier',t=>normalEntrypointFixture(t,'pass','anthropic','mid',false,undefined,true));
for(const fault of ['revoked','late-host-revoked','child-revoked','child-binding-changed','origin-advanced'])test(`recovery original fullscope baseline: ${fault}`,t=>recoveryEntrypointFixture(t,'pass','mid',false,fault));
