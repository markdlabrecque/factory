// Explicit host outbox delivery to one managed tracker comment. Durable operator mode fences I/O; uncertain POST is never replayed.
// Local resolution is a separate audited host-user command, not a tracker/model capability or action approval.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ProjectIdentity, HumanRequest } from '../../orchestrator/supervisor-contract.mts';
import { readSupervisor, commitSupervisor } from './supervisor-state.mts';
const flat = existsSync(new URL('./supervisor-contract.mts', import.meta.url));
const { supervisorHash, validateProject } = await import(flat ? './supervisor-contract.mts' : '../../orchestrator/supervisor-contract.mts');
export type CommentReceipt = { id: string; url: string; body: string };
export type NotificationAdapter = {
  list(project: ProjectIdentity, target: number): CommentReceipt[];
  create(project: ProjectIdentity, target: number, body: string): CommentReceipt;
};
export type NotificationAuthorization = { mode: 'observe' | 'act' | 'stopped'; authorized: boolean; operatorIssue?: number };
export const requestMarker = (h: HumanRequest) => `<!-- factory-supervisor:${supervisorHash({ project: h.project, incidentId: h.incidentId, requestId: h.id, proposalId: h.proposalId })} -->`;
function receiptValid(c: CommentReceipt, p: ProjectIdentity, target: number, marker: string): boolean {
  if (!c || !/^[1-9][0-9]*$/.test(c.id) || !c.body?.includes(marker)) return false;
  const t = p.tracker;
  return c.url === (t.kind === 'github' ? `https://${t.host}/${t.project}/issues/${target}#issuecomment-${c.id}` : `https://${t.host}/${t.project}/-/issues/${target}#note_${c.id}`);
}
/** No background notifier is installed. Authorization must be current host-owned data, never tracker instructions. */
export function deliverSupervisorRequest(o: {
  stateDir: string; project: ProjectIdentity; incidentId: string; current(): NotificationAuthorization;
  adapter?: NotificationAdapter; now?: () => number;
}): { state: 'pending' | 'notified' | 'resolved'; reason?: string } {
  validateProject(o.project);
  let s = readSupervisor(o.stateDir, o.project); const h = s.humans[o.incidentId];
  if (!h) throw Error('Unknown human request');
  if (s.resolutions?.[o.incidentId]) return { state: 'resolved' };
  if (h.delivery.state === 'notified') return { state: 'notified' };
  const stamp = () => new Date((o.now ?? Date.now)()).toISOString();
  const auth = o.current();
  if (s.control && s.control.mode !== 'act' || auth.mode !== 'act' || auth.authorized !== true) return { state: 'pending', reason: 'Tracker notification not authorized in current mode' };
  const target = h.scope.kind === 'ticket' ? h.scope.ticket : auth.operatorIssue;
  if (!Number.isSafeInteger(target) || target! <= 0) return { state: 'pending', reason: 'Project-wide request requires explicit operator issue' };
  const adapter = o.adapter ?? trackerNotificationAdapter();
  const prior = s.deliveries?.[o.incidentId];
  if (prior && prior.target !== target) return { state: 'pending', reason: 'Notification target changed; manual reconciliation required' };
  const marker = requestMarker(h);
  try {
    let response: CommentReceipt;
    if (prior) {
      // A lost/failed POST may have succeeded. Never create again, even if an eventually-consistent list is empty.
      const found = adapter.list(o.project, target!).filter(c => receiptValid(c, o.project, target!, marker));
      if (found.length !== 1) return { state: 'pending', reason: 'Ambiguous delivery; inspect exact managed marker, no automatic repost' };
      response = found[0];
    } else {
      s = commitSupervisor(o.stateDir, o.project, s.revision, { id: `notify-attempt:${h.id}`, at: stamp(), kind: 'notify-attempt', incidentId: o.incidentId, requestId: h.id, target: target! });
      const fresh = o.current();
      const control = readSupervisor(o.stateDir, o.project).control;
      if (control && control.mode !== 'act' || fresh.mode !== 'act' || fresh.authorized !== true || h.scope.kind === 'project' && fresh.operatorIssue !== target) return { state: 'pending', reason: 'Authorization changed; no POST' };
      response = adapter.create(o.project, target!, `${marker}\n**Factory supervisor: human required; actions stopped**\n\n${h.question}\n\nIncident: ${h.incidentId}\nProposal: ${h.proposalId}\nReason: ${h.reason}\n\nOriginal evidence:\n${h.evidence.map(x => `- ${x}`).join('\n')}\n\nNext operator action: ${h.nextAction}\n\nDelivery is NOT approval. Only an explicit audited local operator resolution can permit a different exact proposal and new review. No budget reset, gate mutation or automatic resume.`);
    }
    if (!receiptValid(response, o.project, target!, marker)) return { state: 'pending', reason: 'Tracker response lacks exact comment receipt/marker' };
    s = readSupervisor(o.stateDir, o.project);
    commitSupervisor(o.stateDir, o.project, s.revision, { id: `notify-ack:${h.id}`, at: stamp(), kind: 'notify-ack', incidentId: o.incidentId, requestId: h.id, target: target!, channel: `${o.project.tracker.kind}:issue:${target}`, receipt: response.url });
    return { state: 'notified' };
  } catch (e) { return { state: 'pending', reason: String(e).slice(0, 4000) }; }
}
/** Actual existing host CLI API path, bounded and shell-free. Tests inject its command runner, never contact trackers. */
export function trackerNotificationAdapter(run: typeof spawnSync = spawnSync): NotificationAdapter {
  function api(p: ProjectIdentity, target: number, body?: string): any {
    validateProject(p);
    if (!Number.isSafeInteger(target) || target <= 0) throw Error('Invalid notification target');
    const t = p.tracker, gh = t.kind === 'github';
    const endpoint = gh ? `repos/${t.project}/issues/${target}/comments` : `projects/${encodeURIComponent(t.project)}/issues/${target}/notes`;
    const argv = ['api', '--hostname', t.host, ...(body === undefined ? ['--paginate', `${endpoint}?per_page=100`] : ['-X', 'POST', endpoint, '--input', '-']),
      ...(gh ? ['--full', '--jq', '@base64'] : [])];
    const result = run(gh ? 'gh-axi' : 'glab', argv, { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      ...(body === undefined ? {} : { input: JSON.stringify({ body }) }) });
    if (result.error || result.status !== 0) throw Error('Tracker API failed/uncertain; request remains pending');
    // GitLab pagination emits adjacent arrays, not a single JSON value. Parse arrays without accepting truncated pages.
    let raw = String(result.stdout);
    if (gh) {
      // gh-axi intentionally emits TOON, not raw JSON. Request lossless base64 of each JSON page; accept only
      // its exact untruncated raw-response envelope, never infer acknowledgement from human-readable output.
      const match = /^api_response:\n  body: (.+)\n  truncated: false\s*$/.exec(raw);
      if (!match) throw Error('Unsupported gh-axi API response envelope');
      const encoded = match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
      const pages = encoded.split('\n').map((line: string) => {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(line)) throw Error('Malformed gh-axi base64 response');
        return JSON.parse(Buffer.from(line,'base64').toString('utf8'));
      });
      if (body === undefined) { if (!pages.every(Array.isArray)) throw Error('Incomplete comment pages'); return pages.flat(); }
      if (pages.length !== 1) throw Error('Ambiguous tracker POST response');
      return pages[0];
    }
    if (body === undefined) {
      const pages: unknown[] = []; let start = 0, depth = 0, string = false, escaped = false;
      for (let i = 0; i < raw.length; i++) { const c = raw[i];
        if (string) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') string = false; }
        else if (c === '"') string = true;
        else if (c === '[' || c === '{') { if (depth++ === 0) start = i; }
        else if (c === ']' || c === '}') { if (--depth === 0) pages.push(JSON.parse(raw.slice(start, i + 1))); if (depth < 0) throw Error('Malformed tracker pages'); }
        else if (depth === 0 && !/\s/.test(c)) throw Error('Malformed tracker pages');
      }
      if (depth || string || !pages.length || !pages.every(Array.isArray)) throw Error('Incomplete tracker pages');
      return pages.flat();
    }
    return JSON.parse(raw);
  }
  function comment(p: ProjectIdentity, target: number, x: any): CommentReceipt {
    if (!x || !Number.isSafeInteger(x.id) || x.id <= 0 || typeof x.body !== 'string') throw Error('Invalid tracker comment acknowledgement');
    return { id: String(x.id), body: x.body, url: p.tracker.kind === 'github' ? x.html_url : `https://${p.tracker.host}/${p.tracker.project}/-/issues/${target}#note_${x.id}` };
  }
  return {
    create: (p,t,b) => comment(p,t,api(p,t,b)),
    list: (p,t) => { const xs = api(p,t); if (!Array.isArray(xs)) throw Error('Unknown tracker comments'); return xs.flat().map(x => comment(p,t,x)); },
  };
}
/** The host-user trust boundary is possession of the private state directory, same as other local Factory controls.
 * Actor is supplied by the local CLI from OS identity, never from a flag or model response. */
export function resolveSupervisorRequest(o: { stateDir: string; project: ProjectIdentity; incidentId: string; requestId: string; proposalId: string; actor: string; reason: string; nextProposalId: string | null; now?: () => number }) {
  const s = readSupervisor(o.stateDir, o.project);
  return commitSupervisor(o.stateDir, o.project, s.revision, { id: `local-resolution:${randomUUID()}`, at: new Date((o.now ?? Date.now)()).toISOString(), kind: 'resolve-human',
    incidentId: o.incidentId, requestId: o.requestId, proposalId: o.proposalId, actor: o.actor, reason: o.reason, nextProposalId: o.nextProposalId });
}
