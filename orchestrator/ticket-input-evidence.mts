// Passive bounded projection of host-owned frozen-input manifests. Never fetch trackers, scan logs or execute project code.
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
export interface SavedTicketInput {
  state: 'unknown' | 'frozen'; reason: string; contentHash: string | null; renderedSha256?: string;
  coverage: { source: 'child' | 'parent'; iid: number; operation: string; complete: true; pages: number; bytes: number; included?: number; excluded?: number }[];
  references: { iid: number; url: string; notes: { id: string; url: string }[] }[];
}
const MAX_BYTES = 8 * 1024 * 1024;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const segment = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function safeUrl(v: unknown): v is string {
  try { if (typeof v !== 'string' || v.length > 4096) return false; const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}
/** The path is derived from selected run identity, never a project-supplied evidence path or manifest reference. */
export function readSavedTicketInput(state: string, project: string, iid: string, executionId?: string, attemptId?: string, expectedHash?: string): SavedTicketInput {
  const unknown = (): SavedTicketInput => ({state:'unknown',reason:'No applicable saved ticket-input coverage projection is available',coverage:[],contentHash:null,references:[]});
  if (!/^[1-9]\d*$/.test(iid) || !segment(executionId) || (attemptId !== undefined && !segment(attemptId))) return unknown();
  let dir: number | undefined, fd: number | undefined;
  try {
    const key = `${project.replace(/[^A-Za-z0-9._-]+/g, '_')}--${iid}`;
    const path = resolve(state, 'ticket-inputs', key, executionId, ...(attemptId ? [attemptId] : []));
    if (fs.realpathSync(path) !== path || fs.realpathSync(state) !== resolve(state)) return unknown();
    dir = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const pinned = fs.fstatSync(dir), named = fs.lstatSync(path);
    if (fs.realpathSync(path) !== path || pinned.dev !== named.dev || pinned.ino !== named.ino) return unknown();
    fd = fs.openSync(join(process.platform === 'linux' ? `/proc/self/fd/${dir}` : `/dev/fd/${dir}`, 'ticket-sources.json'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) return unknown();
    const bytes = Buffer.alloc(MAX_BYTES + 1); let n = 0, read: number;
    while ((read = fs.readSync(fd, bytes, n, bytes.length - n, null)) > 0) { n += read; if (n > MAX_BYTES) return unknown(); }
    const v = JSON.parse(bytes.subarray(0,n).toString('utf8'));
    if (v.version !== 1 || v.identity?.project !== project || !hash(v.contentHash) || !hash(v.renderedSha256)
      || (expectedHash !== undefined && expectedHash !== v.contentHash)
      || !Array.isArray(v.coverage) || !v.coverage.length || v.coverage.length > 5
      || !v.coverage.every((c: any) => ['child','parent'].includes(c.source) && Number.isSafeInteger(c.iid) && c.iid > 0 && ['ticket','notes','parentOf'].includes(c.operation) && c.complete === true && count(c.pages) && count(c.bytes) && (c.included === undefined || count(c.included)) && (c.excluded === undefined || count(c.excluded)))
      || !Array.isArray(v.sources) || ![1,2].includes(v.sources.length) || v.sources[0].iid !== Number(iid)
      || !v.sources.every((s: any) => Number.isSafeInteger(s.iid) && s.iid > 0 && safeUrl(s.url) && Array.isArray(s.notes) && s.notes.every((n: any) => typeof n.id === 'string' && n.id.length <= 200 && safeUrl(n.url)))) return unknown();
    return {state:'frozen',reason:'Saved execution input; current tracker freshness is not checked',contentHash:v.contentHash,renderedSha256:v.renderedSha256,
      coverage:v.coverage.map((c: any) => ({source:c.source,iid:c.iid,operation:c.operation,complete:true,pages:c.pages,bytes:c.bytes,...(c.included === undefined ? {} : {included:c.included}),...(c.excluded === undefined ? {} : {excluded:c.excluded})})),
      references:v.sources.map((s: any) => ({iid:s.iid,url:s.url,notes:s.notes.map((n: any) => ({id:n.id,url:n.url}))}))};
  } catch { return unknown(); }
  finally { if (fd !== undefined) fs.closeSync(fd); if (dir !== undefined) fs.closeSync(dir); }
}
