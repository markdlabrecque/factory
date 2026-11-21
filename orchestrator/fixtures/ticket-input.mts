// Source identity matching the bounded refresh tracker stub. No external calls.
import { isSandcastleNote } from '../graph.mts';
import { ticketContextHash, type TicketContextSource } from '../ticket-context.mts';
import { freezeTicketInput } from '../ticket-input.mts';
export function fixtureTicketInput(data: any, iid: number, kind = 'github') {
  const host = kind === 'github' ? 'github.com' : 'git.example.test';
  const ticket = (id: number) => {
    const t = data.tickets.find((t: any) => t.iid === id);
    const url = `https://${host}/owner/repo/${kind === 'github' ? '' : '-/'}issues/${id}`;
    return { iid: id, title: t.title, description: t.description, url,
      notes: (data.notes?.[id] ?? []).filter((n: any) => !isSandcastleNote(n)).map((n: any, i: number) => ({
        id: String(i + 1), body: n.body, system: false, author: 'human', createdAt: '2026-01-01', updatedAt: '2026-01-01',
        url: `${url}${kind === 'github' ? '#issuecomment-' : '#note_'}${i + 1}` })) };
  };
  const source: TicketContextSource = { identity: {kind: kind as 'github' | 'gitlab', host, project:'owner/repo'},
    ticket: id => { const {notes, ...value} = ticket(id); return {value, bytes: 1}; },
    notes: id => ({value: {notes: ticket(id).notes, nextPage: null}, bytes: 1}),
    parentOf: id => ({value: data.parents?.[id] ?? null, bytes: 1}) };
  return freezeTicketInput(source, iid);
}
export function fixtureTicketHash(data: any, iid: number, kind = 'github'): string {
  return fixtureTicketInput(data, iid, kind).hash;
}
