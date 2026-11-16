// Child-only stand-in for private package preparation when npm itself is a fixture stub.
// Real locked-package bytes and patch behavior belong to the opt-in offline package smoke.
import { registerHooks } from 'node:module';
registerHooks({
  load(url, context, next) {
    if (url.endsWith('/sandcastle-patch.mts')) return {
      format: 'module', shortCircuit: true,
      source: 'export function prepareSandcastlePackage() { return {state:"patched",changed:[]}; }',
    };
    return next(url, context);
  },
});
