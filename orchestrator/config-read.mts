// Read-only v2 shell bridge for allowlisted, non-secret scalars. Never evaluates project code.
import { loadTomlConfig } from './project-config.mts';
const [dir, key] = process.argv.slice(2);
try {
  if (!dir) throw new Error('Expected explicit scaffold directory');
  const c = loadTomlConfig(dir);
  const fields: Record<string, string> = { kind: c.TRACKER.kind, host: c.TRACKER.gitlabHost ?? c.TRACKER.host!,
    agent: 'pi', provider: c.AGENT.family === 'openai' ? 'openai' : 'pi-claude-subscription', family: c.AGENT.family,
    image: c.config.image, analysisTimeoutMinutes: String(c.GRAPH.analysisTimeoutMinutes),
    subscription: String(c.AGENT.family === 'anthropic') };
  if (key === 'validate') { for (const w of c.warnings) console.error(`${c.source.path}: warning: ${w}`); }
  else if (!Object.hasOwn(fields, key)) throw new Error('Unsupported metadata field');
  else process.stdout.write(fields[key]);
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
