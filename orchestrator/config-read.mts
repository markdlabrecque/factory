// Recovery preparation reads only the non-secret analysis timeout through this allowlist.
// Read-only shell bridge. Individual allowlisted scalars, never generated shell code or eval.
// TOML is validated first; only the preparation timeout supports the reviewed legacy runtime facade.
import { loadTomlConfig } from './project-config.mts';
const [dir, key] = process.argv.slice(2);
try {
  if (!dir) throw new Error('Expected explicit scaffold directory');
  const c = loadTomlConfig(dir);
  if (!c) {
    if (key !== 'analysisTimeoutMinutes') throw new Error('factory.toml is absent');
    // Reviewed legacy copies still use their runtime facade. Print just this non-secret scalar.
    const {GRAPH} = await import('./runtime-config.mts');
    if (!Number.isFinite(GRAPH.analysisTimeoutMinutes) || GRAPH.analysisTimeoutMinutes <= 0) throw new Error('Invalid analysis timeout');
    process.stdout.write(String(GRAPH.analysisTimeoutMinutes));
    process.exit(0);
  }
  const fields: Record<string, string> = { kind: c.TRACKER.kind, host: c.TRACKER.gitlabHost ?? c.TRACKER.host!,
    agent: c.AGENT.provider, image: c.config.image, analysisTimeoutMinutes: String(c.GRAPH.analysisTimeoutMinutes),
    subscription: String([c.AGENT.model, c.GRAPH.model, ...Object.values(c.AGENT.modelAliases)].some(m => m.startsWith('pi-claude-subscription/'))) };
  if (key === 'validate') { for (const w of c.warnings) console.error(`${c.source.path}: warning: ${w}`); }
  else if (!Object.hasOwn(fields, key)) throw new Error('Unsupported metadata field');
  else process.stdout.write(fields[key]);
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
