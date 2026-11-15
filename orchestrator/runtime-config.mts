// Validate adjacent v2 TOML before runtime use. Agent settings are derived only from Factory policy.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTomlConfig } from './project-config.mts';
import { AGENT_POLICY, MODEL_POLICY, modelForRole } from './model-policy.mts';
export const effectiveConfig = loadTomlConfig(dirname(fileURLToPath(import.meta.url)));
export const { TRACKER, MERGE, LABELS, SUBTASKS } = effectiveConfig;
const family = effectiveConfig.AGENT.family;
export const AGENT = { family, provider: AGENT_POLICY.agent, model: modelForRole(family, 'verification').model,
  thinking: AGENT_POLICY.thinking, modelAliases: { ...MODEL_POLICY[family] } };
export const GRAPH = { ...effectiveConfig.GRAPH, model: modelForRole(family, 'analysis').model };
export const allLabels = () => [...new Set([...LABELS.ready, ...LABELS.exclude, LABELS.needsHuman, LABELS.done])];
for (const warning of effectiveConfig.warnings) console.error(`${effectiveConfig.source.path}: warning: ${warning}`);
