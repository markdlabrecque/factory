// One offline worker/process-adapter boundary with a real disposable journal. Injected clocks/processes, no Pi or live tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseProject } from '../src/supervisor-worker.mts';
import type { ComponentDiagnosisBoundary as DiagnosisBoundary, WorkerOptions } from '../src/supervisor-worker.mts';
import { readSupervisor, supervisorFile, commitSupervisor } from '../src/supervisor-state.mts';
import { supervisorHash, proposalIdentity } from '../../orchestrator/supervisor-contract.mts';
import { modelForRole } from '../../orchestrator/model-policy.mts';
import { diagnosisBasis } from '../../orchestrator/supervisor.mts';
import { supervisorFixture, AT } from './supervisor-fixture.mts';

test('bounded proposal worker reserves before fixed-role Pi, fences cancellation/restart and retains diagnostics without actions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'factory-supervisor-worker-'));
  try {
    let seq = 0;
    function fixture(name: string) {
      const stateDir = join(home, name), a = supervisorFixture(join(home, `project-${name}`));
      let clock = Date.parse(AT), wake = () => {}, gone = true, actual: { tokens: number; cost: number } | null = { tokens: 50, cost: 50 }, spawned = false;
      let process: ChildProcess, run: (input: any) => void = input => complete(JSON.stringify(wait(input)));
      const wait = (input: any) => ({ version: 1, incidentId: input.incidentId, basisHash: input.basisHash,
        classification: 'evidence-mechanism', rationale: 'Original CI is pending; preserve saved work', alternatives: ['Inspect evidence'], action: { kind: 'wait', expectation: 'CI completes' } });
      const complete = (output: string, code = 0) => { process.stdout!.emit('data', Buffer.from(output)); process.stderr!.emit('data', Buffer.from('retained worker diagnostic')); process.emit('exit', code); process.emit('close', code); };
      const b: DiagnosisBoundary = {
        model: modelForRole(a.family, 'supervisor').model, reservation: { tokens: 100, cost: 100 }, pricingKnown: true, accountingKnown: true, enforceable: true,
        start(command, argv, options) {
          spawned = true; assert.equal(command, 'pi');
          const state = readSupervisor(stateDir, a.snapshot.project), reserved = Object.values(state.reservations).find(r => r.state === 'active')!;
          assert.ok(reserved); assert.equal(state.charged.diagnosis.tokens, Object.keys(state.reservations).length * 100);
          assert.equal(argv[argv.indexOf('--model') + 1], modelForRole(a.family, 'supervisor').model);
          for (const arg of ['--no-session','--no-tools','--no-extensions','--no-skills','--no-context-files']) assert.ok(argv.includes(arg));
          for (const arg of ['--resume','--continue','--tools','bash','FlagAHuman']) assert.ok(!argv.includes(arg));
          assert.equal(options.detached, true); assert.equal(options.deadline, reserved.deadline); assert.deepEqual(options.reservation, reserved.reserved);
          assert.ok(options.cwd.startsWith(join(stateDir, 'supervisor')));
          const input = JSON.parse(options.input.slice(options.input.indexOf('\n\n{"version":1')));
          assert.deepEqual(input.snapshot, a.snapshot); assert.equal(input.basisHash, diagnosisBasis(a.snapshot));
          assert.equal(input.snapshot.sources.find((s: any) => s.role === 'human-planning').text, 'original human-planning');
          assert.ok(existsSync(join(options.cwd, 'input.json')));
          process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 98765 }) as unknown as ChildProcess;
          queueMicrotask(() => run(input)); return process;
        },
        async terminate(child) { assert.equal(child, process); return gone; },
        usage() { return actual; },
      };
      const options = (): WorkerOptions => ({ stateDir, current: () => structuredClone(a), boundary: b, now: () => clock,
        invocationId: `invocation-${++seq}`, fence: `fence-${seq}`, subscriptionExtension: '/fixture/provider.ts',
        timer(f) { wake = f; return () => {}; } });
      const exitBeforeDrain = (output: string) => { process.emit('exit', 0); process.stdout!.emit('data', Buffer.from(output)); process.emit('close', 0); };
      return { stateDir, a, b, wait, complete, exitBeforeDrain, options, state: () => readSupervisor(stateDir, a.snapshot.project),
        run: (f: typeof run) => { run = f; }, timeOut: () => { clock += 30000; wake(); },
        advance: (ms: number) => { clock += ms; }, accounting: (value: typeof actual) => { actual = value; }, cleanup: (value: boolean) => { gone = value; }, spawned: () => spawned };
    }
    const f = fixture('observe');
    const result = await diagnoseProject(f.options()); assert.equal(result.state, 'proposed');
    const saved = f.state(); assert.equal(saved.charged.diagnosis.tokens, 100); assert.equal(Object.values(saved.reservations)[0].state, 'finished');
    const d = Object.values(saved.diagnostics!)[0]; assert.equal(d.outcome, 'proposed'); assert.match(d.stderr, /retained worker/);
    assert.deepEqual(saved.intents, {}); assert.deepEqual(saved.reviews, {}); assert.deepEqual(saved.proposals, {});
    assert.ok(readFileSync(d.inputRef, 'utf8').includes('original human-planning'));
    assert.equal(Object.values(saved.incidents)[0].incident.diagnosisCalls, 1);
    // Reopen persisted state at a later observation: unchanged waiting decisions spend no new reservation.
    f.a.snapshot.observedAt = '2026-11-17T12:01:00.000Z';
    f.b.start = () => { throw Error('unchanged wait must not launch a process'); };
    assert.equal((await diagnoseProject(f.options())).state, 'reused'); assert.deepEqual(f.state().charged, saved.charged);
    const preCancelledReuse = new AbortController(); preCancelledReuse.abort();
    assert.equal((await diagnoseProject({ ...f.options(), signal: preCancelledReuse.signal })).state, 'held');
    const corruptedInput = JSON.parse(readFileSync(d.inputRef, 'utf8')); corruptedInput.snapshot.material.settings = 'f'.repeat(64);
    writeFileSync(d.inputRef, JSON.stringify(corruptedInput));
    assert.equal((await diagnoseProject(f.options())).state, 'held'); assert.deepEqual(f.state().charged, saved.charged);

    // The other configured family remains fixed Mid with no fallback.
    const anth = fixture('anthropic'); anth.a.family = 'anthropic'; anth.b.model = modelForRole('anthropic', 'supervisor').model;
    // Explicit extension path is validated without credentials/provider discovery.
    const missingExtension = await diagnoseProject(anth.options()); assert.equal(missingExtension.state, 'held'); assert.equal(anth.spawned(), false);
    const extension = join(home, 'synthetic-provider.ts'); writeFileSync(extension, '// never executed by offline boundary');
    assert.equal((await diagnoseProject({ ...anth.options(), subscriptionExtension: extension })).state, 'proposed');
    const exhausted = fixture('exhausted');
    assert.equal((await diagnoseProject(exhausted.options())).state, 'proposed');
    exhausted.a.snapshot.material.settings = 'c'.repeat(64);
    assert.equal((await diagnoseProject(exhausted.options())).state, 'proposed');
    exhausted.a.snapshot.material.settings = 'd'.repeat(64);
    assert.equal((await diagnoseProject(exhausted.options())).state, 'human-required');
    assert.equal(Object.values(exhausted.state().incidents)[0].incident.diagnosisCalls, 2);
    assert.equal(Object.values(exhausted.state().humans)[0].delivery.state, 'pending');

    for (const kind of ['cancel','timeout','malformed','failed','stale','unknown-usage','unknown-cleanup','overflow','escalate'] as const) {
      const x = fixture(kind), controller = new AbortController();
      x.run(input => {
        if (kind === 'cancel') controller.abort();
        else if (kind === 'timeout') x.timeOut();
        else if (kind === 'malformed') x.complete('{not JSON');
        else if (kind === 'failed') x.complete(JSON.stringify(x.wait(input)), 1);
        else if (kind === 'overflow') x.complete('x'.repeat(200000));
        else if (kind === 'escalate') x.complete(JSON.stringify({ ...x.wait(input), action: { kind: 'escalate', question: 'Choose approved host change?', nextAction: 'Owner must decide; never apply automatically', factoryWide: true } }));
        else { if (kind === 'stale') x.a.paused = true; if (kind === 'unknown-usage') x.accounting(null); if (kind === 'unknown-cleanup') x.cleanup(false); x.complete(JSON.stringify(x.wait(input))); }
      });
      const output = await diagnoseProject({ ...x.options(), signal: controller.signal }); assert.equal(output.state, 'human-required', kind);
      const state = x.state(), diagnostic = Object.values(state.diagnostics!)[0], human = Object.values(state.humans)[0];
      assert.equal(diagnostic.decision === null, kind !== 'escalate', kind); assert.equal(human.delivery.state, 'pending'); assert.equal(human.stop, 'required');
      assert.equal(Object.values(state.reservations)[0].state, kind.startsWith('unknown-') ? 'ambiguous' : 'finished');
      const before = state.charged; const restart = await diagnoseProject(x.options()); assert.equal(restart.state, 'held'); assert.deepEqual(x.state().charged, before);
      assert.deepEqual(state.intents, {}); assert.deepEqual(state.reviews, {});
    }
    const stopped = fixture('operator-stopped');
    commitSupervisor(stopped.stateDir, stopped.a.snapshot.project, 0, {kind:'control',id:'stop',at:AT,mode:'stopped',actor:'uid:fixture',pilot:false});
    assert.equal((await diagnoseProject(stopped.options())).state,'held'); assert.equal(stopped.spawned(),false);
    const lateStop = fixture('operator-stop-in-flight');
    lateStop.run(input => {
      const s=lateStop.state();
      commitSupervisor(lateStop.stateDir,s.project,s.revision,{kind:'control',id:'stop-active',at:AT,mode:'stopped',actor:'uid:fixture',pilot:false});
      lateStop.complete(JSON.stringify(lateStop.wait(input)));
    });
    assert.equal((await diagnoseProject(lateStop.options())).state,'human-required');
    assert.equal(Object.values(lateStop.state().diagnostics!)[0].decision,null); assert.equal(lateStop.state().charged.diagnosis.tokens,100);
    assert.equal(Object.values(lateStop.state().reservations)[0].state,'finished'); // only the original worker's confirmed cleanup/accounting settles
    assert.equal(Object.values(lateStop.state().humans)[0].stop,'required');
    const gate = fixture('gate');
    gate.a.snapshot.observedAt = '2026-11-17T11:59:00.000Z';
    commitSupervisor(gate.stateDir, gate.a.snapshot.project, 0, { kind: 'observe', id: 'prior-observation', at: AT, facts: gate.a.facts,
      snapshotHash: supervisorHash(gate.a.snapshot), reason: 'Earlier host snapshot' });
    gate.a.snapshot.observedAt = AT;
    gate.run(input => {
      const body = { version: 1 as const, project: gate.a.snapshot.project, scope: gate.a.snapshot.scope, incidentId: input.incidentId, snapshotHash: supervisorHash(gate.a.snapshot),
        change: { category: 'additive-instruction-correction' as const, path: 'guidelines.md', before: 'old', after: 'equivalent', owner: { ticket: 236, runId: 'run-a' }, expiresAt: '2026-11-17T13:00:00.000Z' },
        rationale: 'Correct additive guidance', alternatives: ['Repair evidence'], risks: ['Needs independent review'] };
      gate.complete(JSON.stringify({ ...gate.wait(input), action: { kind: 'gate-change', proposal: { ...body, id: proposalIdentity(body) } } }));
    });
    assert.equal((await diagnoseProject(gate.options())).state, 'proposed');
    assert.equal(Object.keys(gate.state().proposals).length, 1); assert.deepEqual(gate.state().reviews, {}); assert.deepEqual(gate.state().intents, {});
    assert.notEqual(Object.values(gate.state().incidents)[0].incident.snapshotHash, Object.values(gate.state().proposals)[0].snapshotHash);
    gate.a.snapshot.observedAt = '2026-11-17T12:01:00.000Z';
    assert.equal((await diagnoseProject(gate.options())).state, 'reused');
    gate.advance(3_600_001); assert.equal((await diagnoseProject(gate.options())).state, 'held');
    assert.equal(Object.values(gate.state().incidents)[0].incident.diagnosisCalls, 1);

    // A second call cannot steal an active project fence; shared capacity blocks another project too.
    const active = fixture('active'); active.a.capacity = 1;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    active.run(input => { entered.resolve(); void release.promise.then(() => active.complete(JSON.stringify(active.wait(input)))); });
    const running = diagnoseProject(active.options()); await entered.promise;
    const concurrent = await diagnoseProject(active.options()); assert.equal(concurrent.state, 'held');
    const peerAuth = supervisorFixture(join(home, 'project-peer')); peerAuth.capacity = 1;
    const peer = await diagnoseProject({ ...active.options(), current: () => peerAuth }); assert.equal(peer.state, 'held');
    const state = active.state(), r = Object.values(state.reservations)[0];
    assert.throws(() => commitSupervisor(active.stateDir, state.project, state.revision, { id: 'stolen-fence', at: AT, kind: 'finish', reservationId: r.id, fence: 'foreign', owner: r.owner, actual: { tokens: 1, cost: 1 } }), /fence/);
    release.resolve(); assert.equal((await running).state, 'proposed');

    // Disabled, locks, unknown pricing/enforcement, model substitution, pre-cancellation and project budgets never spawn.
    for (const mode of ['disabled','lock','global','pricing','unenforceable','model','pre-cancel','budget'] as const) {
      const x = fixture(mode), controller = new AbortController();
      if (mode === 'disabled') x.a.policy.enabled = false;
      if (mode === 'lock') x.a.outsideAdmissionLocks = false;
      if (mode === 'global') x.a.globalAllowed = false;
      if (mode === 'pricing') x.b.pricingKnown = false;
      if (mode === 'unenforceable') x.b.enforceable = false;
      if (mode === 'model') x.b.model = modelForRole('openai', 'gateReview').model;
      if (mode === 'pre-cancel') controller.abort();
      if (mode === 'budget') x.a.policy.limits!.diagnosis.maxTokens = 50;
      assert.equal((await diagnoseProject({ ...x.options(), signal: controller.signal })).state, 'held', mode); assert.equal(x.spawned(), false);
      assert.equal(Object.keys(x.state().reservations).length, 0);
    }
    const drained = fixture('drain-after-exit');
    drained.run(input => {
      // Node permits stdout data after process exit. Only close establishes complete output.
      drained.exitBeforeDrain(JSON.stringify(drained.wait(input)));
    });
    assert.equal((await diagnoseProject(drained.options())).state, 'proposed');
    assert.ok(existsSync(supervisorFile(f.stateDir)));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
