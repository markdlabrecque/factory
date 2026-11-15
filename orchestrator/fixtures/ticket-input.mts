// Source identity matching the bounded refresh tracker stub. No external calls.
import { isSandcastleNote } from '../graph.mts';
import { ticketContextHash } from '../ticket-context.mts';
export function fixtureTicketHash(data: any, iid: number, kind = 'github'): string {
  const host = kind === 'github' ? 'github.com' : 'git.example.test';
  const ticket = (id: number) => {
    const t = data.tickets.find((t: any) => t.iid === id);
    const url = `https://${host}/owner/repo/${kind === 'github' ? '' : '-/'}issues/${id}`;
    return { iid: id, title: t.title, description: t.description, url,
      notes: (data.notes?.[id] ?? []).filter((n: any) => !isSandcastleNote(n)).map((n: any, i: number) => ({
        id: String(i + 1), body: n.body, system: false, author: 'human', createdAt: '2026-01-01', updatedAt: '2026-01-01',
        url: `${url}${kind === 'github' ? '#issuecomment-' : '#note_'}${i + 1}` })) };
  };
  return ticketContextHash({ version: 1, identity: {kind: kind as 'github' | 'gitlab', host, project:'owner/repo'},
    child: ticket(iid), parent: data.parents?.[iid] ? ticket(data.parents[iid]) : null });
}
