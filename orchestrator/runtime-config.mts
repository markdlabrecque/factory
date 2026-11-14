// #137: resolve the adjacent TOML BEFORE importing any executable legacy project settings.
// Absent TOML preserves custom legacy contracts; present TOML replaces them completely.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTomlConfig } from './project-config.mts';
export const effectiveConfig = loadTomlConfig(dirname(fileURLToPath(import.meta.url)));
const legacy = effectiveConfig ? undefined : await import('./config.mts');
const runtime = effectiveConfig ?? legacy!;
export const { TRACKER, AGENT, MERGE, LABELS, SUBTASKS, GRAPH } = runtime;
export const allLabels = effectiveConfig
  ? () => [...new Set([...LABELS.ready, ...LABELS.exclude, LABELS.needsHuman, LABELS.done])]
  : legacy!.allLabels;
if (effectiveConfig) for (const warning of effectiveConfig.warnings) console.error(`${effectiveConfig.source.path}: warning: ${warning}`);
