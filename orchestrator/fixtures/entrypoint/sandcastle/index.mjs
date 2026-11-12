// Test-only stand-in for @ai-hero/sandcastle in the recovery entrypoint smoke test (#74). Recovery must never use
// createSandbox (its worktree manager is unsafe for preserved work), so calling it throws. The agent providers record
// the model they were asked for in $FAKE_STATE/models.log and build a print command from $FAKE_REPAIR (the repair
// prompt) or $FAKE_VERIFY (any other prompt).
import { appendFileSync } from "node:fs";
import { join } from "node:path";
const provider = (kind) => (model) => {
  appendFileSync(join(process.env.FAKE_STATE, "models.log"), `${kind} ${model}\n`);
  return { name: kind, env: {}, buildPrintCommand: ({ prompt }) => ({ command: prompt.startsWith("# Recover ticket") ? process.env.FAKE_REPAIR : process.env.FAKE_VERIFY }) };
};
export const claudeCode = provider("claude");
export const pi = provider("pi");
export const createSandbox = async () => { throw new Error("createSandbox must not be used by a recovery attempt"); };
