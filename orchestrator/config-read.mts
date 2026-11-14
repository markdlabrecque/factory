// #137: dependency-free read-only shell bridge. Individual allowlisted scalars, never generated shell
// code or eval; loading validates the entire TOML file before printing any field.
import { loadTomlConfig } from './project-config.mts';
const [dir, key] = process.argv.slice(2);
try {
  if (!dir) throw new Error('Expected explicit scaffold directory');
  const c = loadTomlConfig(dir);
  if (!c) throw new Error('factory.toml is absent');
  const fields: Record<string, string> = { kind: c.TRACKER.kind, host: c.TRACKER.gitlabHost ?? c.TRACKER.host!,
    agent: c.AGENT.provider, image: c.config.image,
    subscription: String([c.AGENT.model, c.GRAPH.model, ...Object.values(c.AGENT.modelAliases)].some(m => m.startsWith('pi-claude-subscription/'))) };
  if (key === 'validate') { for (const w of c.warnings) console.error(`${c.source.path}: warning: ${w}`); }
  else if (!Object.hasOwn(fields, key)) throw new Error('Unsupported metadata field');
  else process.stdout.write(fields[key]);
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
