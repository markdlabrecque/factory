// Project-root v2 data and a validated runtime. Executing entrypoints own leases, never this read-only facade.
import { executionContext } from './context.mts';
import { AGENT_POLICY, MODEL_POLICY, modelForRole } from './model-policy.mts';
export const context = await executionContext();
// Existing state helpers read the environment at call time. Keep their root identical to the validated context.
process.env.SANDCASTLE_STATE_DIR = context.sharedState;
export const effectiveConfig = context.config;
export const { TRACKER, MERGE, LABELS, SUBTASKS } = effectiveConfig;
const family = effectiveConfig.AGENT.family;
export const AGENT = { family, provider: AGENT_POLICY.agent, model: modelForRole(family, 'verification').model,
  thinking: AGENT_POLICY.thinking, modelAliases: { ...MODEL_POLICY[family] } };
export const GRAPH = { ...effectiveConfig.GRAPH, model: modelForRole(family, 'analysis').model };
export const allLabels = () => [...new Set([...LABELS.ready, ...LABELS.exclude, LABELS.needsHuman, LABELS.done])];
for (const warning of effectiveConfig.warnings) console.error(`${effectiveConfig.source.path}: warning: ${warning}`);
