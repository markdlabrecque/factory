// Passive sanitized version-1 CLI status adapter. Registry-only selection, no model, tracker, control or journal writes.
// Standalone Boards without the host CLI report UNKNOWN rather than manufacturing empty budgets or approvals.
import { buildReadinessData, registryFile } from './readiness-view.mts';
import { exportEvents, supervisorOutcomeMetrics } from './execution-events.mts';

/** Defense in depth over the CLI allowlist; every string including identities is untrusted display data. */
export function supervisorText(value: string): string {
  return value.replace(/-----BEGIN [^-]*(?:PRIVATE KEY|SECRET)[^-]*-----[\s\S]*?(?:-----END [^-]+-----|$)/gi, '[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/\b(?:authorization|password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\n]+/gi, '[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/gi, s => { try { const u = new URL(s); if (u.protocol !== 'https:' || /(?:secret|credential|\.env|op:)/i.test(u.pathname)) return '[REDACTED URL]'; u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.href; } catch { return '[REDACTED URL]'; } })
    .replace(/(^|[^A-Za-z0-9_./-])(?:\/[A-Za-z0-9_.~-]+)+[^\s<>"'`\[\](){},;]*|[A-Za-z]:\\[^\s<>"']+|(?:~\/|op:\/\/)[^\s<>"'`\[\](){},;]+/g, '$1[REDACTED PATH]')
    .replace(/(?<![\w])(?:\.?[\w.-]+\/)*(?:\.ssh|\.env(?:\.[\w.-]+)?|[\w.-]*(?:credentials?|secrets?)[\w.-]*)(?:\/[^\s<>"'`\[\](){},;]+)?/gi, '[REDACTED PATH]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}
export function sanitizeSupervisor(value: unknown): any {
  if (typeof value === 'string') return supervisorText(value);
  if (Array.isArray(value)) return value.map(sanitizeSupervisor);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [supervisorText(k), sanitizeSupervisor(v)]));
  return value;
}
export type StatusReader = (root: string, offset: number) => Promise<any>;
export async function buildSupervisorData(stateRoot: string, offset = 0, options: { registry?: string; read?: StatusReader; now?: number } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid supervisor offset');
  const registered = buildReadinessData(stateRoot, options.registry ?? registryFile(), options.now);
  const read: StatusReader = options.read ?? (async () => { throw Error('Host inspection unavailable'); });
  const projects = [];
  // Sequential, bounded by the existing registry cap. No browser-supplied path is resolved.
  for (const project of registered.projects) {
    try {
      const status = await read(project.root, offset);
      if (status?.version !== 1 || status.authority !== 'observation-only' || !Number.isSafeInteger(status.revision) || status.revision <= 0) throw Error('Missing or unsupported journal');
      const key = status.telemetry?.projectKey;
      const exported = typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? exportEvents(stateRoot, { project: status.project.tracker.project }) : null;
      projects.push({ name: supervisorText(project.name), state: 'known', status: sanitizeSupervisor(status),
        outcomes: exported ? sanitizeSupervisor(supervisorOutcomeMetrics(exported.events.filter(e => e.supervisor?.projectId === key), status.confirmedProgress ?? [], offset)) : null,
        telemetryDiagnostics: exported?.diagnostics ?? null });
    } catch { projects.push({ name: supervisorText(project.name), state: 'unknown', status: null, reason: 'UNKNOWN: supervisor journal or host inspection unavailable, missing or corrupt. No repair or activation attempted.' }); }
  }
  return { version: 1, authority: 'observation-only', generatedAt: registered.generatedAt, offset, projects, ...(registered.reason ? { reason: 'UNKNOWN: project registry unavailable.' } : {}) };
}

