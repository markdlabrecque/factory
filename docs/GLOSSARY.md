# Factory

Factory coordinates ticket-driven implementation, independent verification and delivery of changes. Its domain model separates the work requested, attempts to perform it, and the authority to publish the result.

See the [domain model](domain-model.md) for relationships, lifecycle rules and code references.

## Language

### Requested work

**Project**:
A repository configured for Factory to work on, with its own work-selection and delivery policies.
_Avoid_: Workspace, installation

**Batch**:
A fixed set of named tickets for one project whose approved changes share a single integration branch.
_Avoid_: Queue, milestone

**Batch handoff**:
The final account of the branch tip and each member’s outcome returned to the operator for testing and onward decisions.
_Avoid_: Deployment, promotion

**Tracker**:
The service that holds a project's tickets and receives its proposed changes, such as GitHub or GitLab.
_Avoid_: Issue system, forge

**Ticket**:
An issue in a tracker describing requested work, including the requirements against which a change is checked.
_Avoid_: Story, card, job

**Task**:
A tracked child work item under a parent ticket that can receive its own run when child-work selection is enabled.
_Avoid_: Step, stage

**Requirement**:
An outcome or prerequisite needed by a ticket, which may be provided by another ticket.
_Avoid_: Implementation step

**Dependency**:
A directed relationship in which one ticket needs work supplied by another before it can proceed.
_Avoid_: Conflict, priority

**Footprint**:
The set of project paths a ticket is expected to change or has actually changed.
_Avoid_: Scope, ownership

**Conflict**:
A relationship between tickets whose overlapping footprints prevent their work from proceeding concurrently.
_Avoid_: Dependency, merge conflict

**Ticket graph**:
The tickets and their dependency and conflict relationships used to decide which work can proceed together.
_Avoid_: Backlog order, dependency tree

### Execution and admission

**Run**:
An attempt to implement, verify and deliver one ticket's change, which may stop or wait without delivering.
_Avoid_: Ticket, job, build

**Stage**:
The current workflow position of a run, including positions where it is queued, waiting or stopped.
_Avoid_: Ticket state, verdict

**Dispatcher**:
The coordinator that selects eligible tickets, holds work that must wait and admits runs within the concurrency limit.
_Avoid_: Agent, scheduler

**Admission claim**:
Exclusive authority to run work for a ticket while reserving capacity; a recovery claim also excludes other runs in that project.
_Avoid_: Board card, reservation note

**Assessment**:
A current observation of a ticket's selection, model choice and dependencies, distinct from the historical facts of a run.
_Avoid_: Run result, launch authorization

**Execution analysis**:
A ticket analysis used for dispatch decisions, describing what the ticket provides, requires and is expected to change.
_Avoid_: Assessment, implementation plan

**Readiness observation**:
A scoped observation of whether required execution resources are accessible, with a ready, blocked or unknown result.
_Avoid_: Approval, launch authorization

**Jam**:
A project condition in which still-selected work is stuck behind stopped work, with no active run or remaining analysis or capacity wait to explain the lack of progress.
_Avoid_: Any queued ticket, temporary wait

### Project supervision

**Project supervisor**:
The durable responsibility for observing a project's progress and problems and proposing bounded responses under host authority.
_Avoid_: Permanent agent, scheduler, autonomous operator

**Supervisor incident**:
A tracked episode of a project or ticket problem, distinct from the attempts to diagnose or resolve it.
_Avoid_: Run, retry, failure log

**Supervisor proposal**:
An exact suggested response to an incident, with its rationale, alternatives, risks and intended scope.
_Avoid_: Authorization, action, instruction

**Gate review**:
An independent judgment on one exact proposed change to a project's gate expectations under its guidelines and Factory's constraints.
_Avoid_: Verification verdict, waiver, self-approval

**Human request**:
An actionable escalation requiring an operator decision, distinct from notification delivery and from authorization to resume work.
_Avoid_: Log line, needs-human label, approval

### Agents and verification

**Agent**:
An AI participant assigned a role in a run or its preparation.
_Avoid_: Dispatcher, autonomous operator

**Implementer**:
The agent responsible for making a ticket's candidate change.
_Avoid_: Verifier

**Verifier**:
The independent agent responsible for checking the candidate change against its requirements and collecting evidence.
_Avoid_: Implementer, CI

**Model tier**:
A small, mid or large work-size category resolved through Factory's model-family policy.
_Avoid_: Model name, agent role

**Model**:
The specific AI model selected for an agent's work under Factory policy.
_Avoid_: Tier, provider

**Sandbox**:
The isolated environment in which an agent performs its assigned work with explicitly provided project resources.
_Avoid_: Host, project

**Evidence**:
Command output, images, video and explanations supporting a verifier's judgment about a change.
_Avoid_: Verdict, guarantee

**Verdict**:
The verifier's conclusion of PASS, FAIL or INCONCLUSIVE for a candidate change.
_Avoid_: Stage, merge status

**Verification proof**:
The host's record binding a verification report and its evidence to the exact change, requirements and execution context checked.
_Avoid_: Proof of correctness, verdict alone

### Delivery and recovery

**Delivery**:
The host-controlled publication of a verified change to the tracker under project policy; publication and merge are distinct outcomes.
_Avoid_: Ticket completion, verification

**Delivery checkpoint**:
A host-owned record identifying a published change and the verified execution behind it, together with its observed delivery state.
_Avoid_: PR link, agent report

**Recovery attempt**:
A bounded attempt to repair a recorded run's saved work and pass it through verification and delivery again.
_Avoid_: Fresh ticket run, unconditional retry

### Runtime and operations

**Profile**:
A preset of project-configuration defaults, such as personal or client.
_Avoid_: Workflow override, model family

**Runtime**:
The complete selected workflow implementation and its dependencies used by an invocation and its children.
_Avoid_: Project settings, individual copied script

**Board**:
The operator view of runs, their progress, current ticket assessments and recorded outcomes across projects.
_Avoid_: Tracker, admission authority
