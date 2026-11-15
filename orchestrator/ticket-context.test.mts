// Offline raw tracker fixtures prove collection, completeness, filtering and canonical prompt bytes.
// No configured runtime, tracker CLI, agent, filesystem probe or external resource is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectTicketContext, ContextReadError, renderTicketContext, ticketContextHash } from './ticket-context.mts';
import type { TicketContextSource, TicketContextResult, TicketContext } from './ticket-context.mts';
import { structuredContextSource } from './ticket-context-source.mts';

const specification = 'Implement versioned settings.\r\nKeep the full audit, packaging requirements and acceptance tests.\n' + 'untruncated specification '.repeat(200);
const plan = '<details>\n<summary>Implementation plan and decisions</summary>\nUse the shared runtime, preserve exact-SHA proof.\n</details>';
function fixture(kind: 'github' | 'gitlab', change: (args: string[], response: any) => any = (_a, r) => r) {
  const calls: string[][] = [];
  const source = structuredContextSource({ kind, host: `${kind}.example`, project: 'group/repo' }, ({ args }, budget) => {
    calls.push(args);
    assert.ok(budget.maxBytes > 0 && budget.timeoutMs > 0);
    assert.equal(args[0], 'api', 'no human-formatted issue view');
    let response: any;
    const path = args[1];
    if (path === 'graphql') response = kind === 'github'
      ? { data: { repository: { issue: { parent: { number: 160 } } } } }
      : { data: { project: { workItems: { nodes: [{ iid: '161', workItemType: { name: 'Task' }, widgets: [{ parent: { iid: '160' } }] }] } } } };
    else {
      const iid = Number(path.match(/issues\/(\d+)/)?.[1]);
      assert.ok([160, 161].includes(iid), 'only child and immediate parent are read');
      if (!path.includes('?')) response = kind === 'github'
        ? { number: iid, title: iid === 161 ? 'Define settings and packaging' : 'Shared runtime epic', body: iid === 161 ? specification : 'Parent scope' }
        : { iid, title: iid === 161 ? 'Define settings and packaging' : 'Shared runtime epic', description: iid === 161 ? specification : 'Parent scope' };
      else {
        const page = Number(path.match(/[?&]page=(\d+)/)?.[1]);
        assert.ok(page === 1 || page === 2);
        const bodies = page === 1 ? Array.from({ length: 100 }, (_, n) => `Human discussion ${n}`)
          : [iid === 160 ? plan : 'Child acceptance: preserve configured instructions.',
            '<!-- sandcastle --> generated verification', '  ## Sandcastle verification: PASS',
            ...(kind === 'gitlab' ? ['system event'] : [])];
        response = bodies.map((body, n) => ({ id: (page - 1) * 100 + n + 1, body,
          created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T00:00:00Z',
          ...(kind === 'github' ? { user: { login: 'human' } } : { author: { username: 'human' }, system: body === 'system event' }) }));
      }
    }
    return JSON.stringify(change(args, response));
  }, 42);
  return { source, calls };
}
function complete(result: TicketContextResult): TicketContext {
  assert.equal(result.status, 'complete', JSON.stringify(result));
  if (result.status !== 'complete') throw Error('expected complete');
  return result.context;
}
function hold(result: TicketContextResult, reason: string, source = 'child', operation = 'notes') {
  assert.equal(result.status, 'hold');
  if (result.status !== 'hold') throw Error('expected hold');
  assert.equal(result.reason, reason); assert.equal(result.source, source); assert.equal(result.operation, operation);
  assert.equal('context' in result, false, 'never expose partial ready context');
  assert.match(result.nextAction, /Inspect/); assert.equal(result.automaticRecheck, 'next-collection');
  return result;
}
for (const kind of ['github', 'gitlab'] as const) {
  test(`${kind}: observed missing-spec/parent-plan shape renders full structured bytes across pages`, () => {
    const f = fixture(kind), context = complete(collectTicketContext(f.source, 161));
    assert.equal(context.child.description, specification);
    assert.equal(context.child.notes.length, 101); assert.equal(context.parent?.notes.length, 101);
    assert.equal(context.parent?.notes.at(-1)?.body, plan);
    assert.equal(context.coverage.length, 5);
    assert.ok(context.coverage.every(c => c.complete));
    assert.equal(context.collection.pages, 7);
    assert.equal(f.calls.length, 7);
    assert.equal(context.coverage.find(c => c.source === 'parent' && c.operation === 'notes')?.pages, 2);
    const rendered = renderTicketContext(context);
    assert.match(rendered, /untrusted tracker task data/);
    const saved = JSON.parse(rendered.split('\n').slice(2, -1).join('\n'));
    assert.equal(saved.child.description, specification);
    assert.equal(saved.parent.notes.at(-1).body, plan);
    assert.equal(saved.contentHash, ticketContextHash(saved));
    assert.ok(!rendered.includes('<!-- sandcastle -->'));
    assert.ok(!rendered.includes('<details>'), 'markup remains data in JSON');
    assert.equal(renderTicketContext(context), rendered, 'canonical rendering');
  });
  test(`${kind}: empty notes and successful absent parent are valid`, () => {
    const f = fixture(kind, (a, r) => a[1] === 'graphql' ? kind === 'github'
      ? { data: { repository: { issue: { parent: null } } } }
      : { data: { project: { workItems: { nodes: [{ iid: '161', workItemType: { name: 'Task' }, widgets: [{ parent: null }] }] } } } }
      : a[1].includes('?') ? [] : r);
    const c = complete(collectTicketContext(f.source, 161));
    assert.equal(c.parent, null); assert.deepEqual(c.child.notes, []);
    assert.ok(c.coverage.some(c => c.operation === 'parentOf' && c.complete));
  });
  test(`${kind}: missing issue/hierarchy is unknown, not parentless`, () => {
    const f = fixture(kind, (a, r) => a[1] === 'graphql' ? kind === 'github'
      ? { data: { repository: { issue: null } } } : { data: { project: { workItems: { nodes: [] } } } } : r);
    hold(collectTicketContext(f.source, 161), 'malformed', 'child', 'parentOf');
  });
  test(`${kind}: required parent read failure is attributable without leaking stderr`, () => {
    const f = fixture(kind, (a, r) => { if (/issues\/160$/.test(a[1])) throw Error('secret upstream stderr'); return r; });
    const h = hold(collectTicketContext(f.source, 161), 'read-failed', 'parent', 'ticket');
    assert.equal(h.sourceIid, 160); assert.ok(!JSON.stringify(h).includes('secret'));
  });
  test(`${kind}: malformed/later-page failure never becomes empty comments`, () => {
    for (const bad of [null, {}, [{ id: 1, body: 'missing metadata' }]]) {
      const f = fixture(kind, (a, r) => a[1].includes('page=2') ? bad : r);
      hold(collectTicketContext(f.source, 161), 'malformed');
    }
    const f = fixture(kind, (a, r) => { if (a[1].includes('page=2')) throw Error('unavailable'); return r; });
    hold(collectTicketContext(f.source, 161), 'read-failed');
  });
  test(`${kind}: duplicate pagination and required bounds return actionable holds`, () => {
    const duplicate = fixture(kind, (a, r) => a[1].includes('page=2') ? [{ ...r[0], id: 1 }] : r);
    hold(collectTicketContext(duplicate.source, 161), 'pagination');
    const f = fixture(kind);
    hold(collectTicketContext(f.source, 161, { limits: { maxPages: 2 } }), 'page-limit');
    hold(collectTicketContext(f.source, 161, { limits: { maxBytes: 10 } }), 'byte-limit', 'child', 'ticket');
    let time = 0;
    const timed: TicketContextSource = { ...f.source, notes(iid, page, budget) { const r = f.source.notes(iid, page, budget); time += 100; return r; } };
    hold(collectTicketContext(timed, 161, { now: () => time, limits: { timeoutMs: 50 } }), 'timeout');
  });
  test(`${kind}: parent decisions change hash; generated notes and collection facts do not`, () => {
    const original = complete(collectTicketContext(fixture(kind).source, 161));
    const edited = complete(collectTicketContext(fixture(kind, (a, r) => {
      if (a[1].includes('issues/160/') && a[1].includes('page=2')) r[0].body += '\nNew human decision'; return r;
    }).source, 161));
    assert.notEqual(original.contentHash, edited.contentHash);
    const generated = complete(collectTicketContext(fixture(kind, (a, r) => {
      if (a[1].includes('page=2')) r[1].body += ' changed generated content'; return r;
    }).source, 161, { now: () => 12345 }));
    assert.equal(original.contentHash, generated.contentHash);
    const whitespace = structuredClone(original); whitespace.child.description += '\r\n';
    assert.notEqual(ticketContextHash(whitespace), original.contentHash, 'no whitespace normalization');
    const ordered = structuredClone(original); ordered.parent!.notes.reverse();
    assert.notEqual(ticketContextHash(ordered), original.contentHash);
  });
}
// Public issue bodies/comments captured with gh-axi on 2026-11-15, not local logs.
// Metadata and API response wrappers below are synthetic; no test makes a live tracker call.
const observed = JSON.parse(readFileSync(new URL('./fixtures/ticket-context-161-162.json', import.meta.url), 'utf8'));
for (const kind of ['github', 'gitlab'] as const) for (const iid of [161, 162]) {
  test(`${kind}: actual task ${iid} specification and full parent planning comments reach rendered prompt data`, () => {
    const source = structuredContextSource({ kind, host: `${kind}.example`, project: 'fixture/repo' }, ({ args }) => {
      if (args[1] === 'graphql') return JSON.stringify(kind === 'github'
        ? { data: { repository: { issue: { parent: { number: 160 } } } } }
        : { data: { project: { workItems: { nodes: [{ iid: String(iid), workItemType: { name: 'Task' }, widgets: [{ parent: { iid: '160' } }] }] } } } });
      const n = Number(args[1].match(/issues\/(\d+)/)?.[1]);
      assert.ok(n === iid || n === 160);
      const t = observed[String(n)];
      if (!args[1].includes('?')) return JSON.stringify(kind === 'github'
        ? { number: n, title: t.title, body: t.description } : { iid: n, title: t.title, description: t.description });
      return JSON.stringify(t.comments.map((body: string, i: number) => ({ id: i + 1, body,
        created_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-15T00:00:00Z',
        ...(kind === 'github' ? { user: { login: 'human' } } : { author: { username: 'human' }, system: false }) })));
    }, 42);
    const c = complete(collectTicketContext(source, iid));
    const prompt = JSON.parse(renderTicketContext(c).split('\n').slice(2, -1).join('\n'));
    assert.equal(prompt.child.description, observed[String(iid)].description);
    assert.ok(prompt.child.description.includes('## Changes'));
    assert.ok(prompt.child.description.includes('## Done when'));
    assert.deepEqual(prompt.parent.notes.map((n: { body: string }) => n.body), observed['160'].comments);
    assert.ok(prompt.parent.notes.some((n: { body: string }) => n.body.includes('<summary>Implementation plan</summary>')));
    assert.equal(prompt.child.notes.length, 0, 'the generated blocked note on task 162 is not human planning');
  });
}
test('parent comments cannot fail or exceed bounds and leave a partial snapshot', () => {
  for (const kind of ['github', 'gitlab'] as const) {
    const f = fixture(kind, (a, r) => { if (a[1].includes('issues/160/') && a[1].includes('page=2')) throw new ContextReadError('timeout'); return r; });
    hold(collectTicketContext(f.source, 161), 'timeout', 'parent', 'notes');
    hold(collectTicketContext(fixture(kind).source, 161, { limits: { maxPages: 6 } }), 'page-limit', 'parent', 'notes');
  }
});
test('GitLab preserves Task-only hierarchy semantics and rejects missing Task hierarchy widgets', () => {
  const issue = fixture('gitlab', (a, r) => { if (a[1] === 'graphql') r.data.project.workItems.nodes[0].workItemType.name = 'Issue'; return r; });
  assert.equal(complete(collectTicketContext(issue.source, 161)).parent, null);
  const missing = fixture('gitlab', (a, r) => { if (a[1] === 'graphql') r.data.project.workItems.nodes[0].widgets = []; return r; });
  hold(collectTicketContext(missing.source, 161), 'malformed', 'child', 'parentOf');
});
test('full page requires terminal empty page; invalid cursors cannot establish completion', () => {
  const f = fixture('github', (a, r) => a[1].includes('page=2') ? [] : r);
  const c = complete(collectTicketContext(f.source, 161));
  assert.equal(c.child.notes.length, 100); assert.equal(c.collection.pages, 7);
  const original = fixture('github').source;
  for (const nextPage of [undefined, 1, 3]) {
    const bad = { ...original, notes: (iid, page, budget) => ({ ...original.notes(iid, page, budget), value: { notes: [], nextPage } }) } as TicketContextSource;
    hold(collectTicketContext(bad, 161), 'pagination');
  }
});
test('typed read timeouts and malformed JSON hold without treating them as successful absence', () => {
  for (const mode of ['timeout', 'json', 'graphql-errors']) {
    const f = fixture('github', (a, r) => {
      if (mode === 'timeout') throw new ContextReadError('timeout');
      if (mode === 'graphql-errors' && a[1] === 'graphql') return { errors: [{ type: 'NOT_FOUND' }], data: { repository: { issue: null } } };
      return r;
    });
    if (mode === 'json') {
      const source = structuredContextSource(f.source.identity, () => 'not JSON');
      hold(collectTicketContext(source, 161), 'malformed', 'child', 'ticket');
    } else hold(collectTicketContext(f.source, 161), mode === 'timeout' ? 'timeout' : 'read-failed', 'child', mode === 'timeout' ? 'ticket' : 'parentOf');
  }
});
