// #137: shared candidate/unit selection, separate from admission/ordering/analysis holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excludedAssignees, membershipEligibility, selectCandidates, unitEligibility } from './selection.mts';
const ticket = { iid:7,title:'Ticket',description:'',state:'open',labels:[],assignees:[{username:'bob'},{username:'alice'}] };
test('any excluded assignee vetoes, including @me and multi-assignee tickets', () => {
  const s = {excludeAssignees:['@me']};
  assert.deepEqual(selectCandidates([ticket],s,()=> 'alice'),[]);
  assert.deepEqual(selectCandidates([ticket],s,()=> 'charlie'),[ticket]);
  assert.throws(()=>excludedAssignees(s),/unknown/);
  assert.throws(()=>excludedAssignees(s,()=>''),/unknown/);
  assert.equal(membershipEligibility(7,[ticket],['alice']).reasons[0].code,'excluded-assignee');
});
test('children inherit readiness but not immunity from unit label/state vetoes', () => {
  assert.equal(unitEligibility(ticket,true,['blocked']).status,'selected');
  assert.equal(unitEligibility({...ticket,labels:['blocked']},true,['blocked']).status,'not-selected');
  assert.equal(unitEligibility({...ticket,state:'closed'},true,[]).reasons[0].code,'closed');
  assert.equal(unitEligibility(ticket,false,[]).reasons[0].code,'tracker-filters');
  assert.equal(membershipEligibility(7,[ticket],[]).status,'selected');
  assert.equal(membershipEligibility(8,[ticket],[]).status,'not-selected');
});
