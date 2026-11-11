# Factory

Factory turns tickets into reviewed changes. An AI agent implements each ticket, proves it works, and opens a pull request, while a board shows every run live.

## Language

### Work

**Ticket**:
An issue in a tracker that describes one change to build.
_Avoid_: Task, story, card

**Tracker**:
The service that holds tickets and receives the pull request, such as GitHub or GitLab.
_Avoid_: Issue system, forge

**Run**:
One attempt to take a single ticket from start to a pull request.
_Avoid_: Job, build, execution

**Stage**:
The step a run is currently on, from implementing through verifying to finished.
_Avoid_: Phase, status

**Evidence**:
Screenshots, videos, and text that show a run's change works.
_Avoid_: Proof, artifacts, attachments

### Agents

**Agent**:
The AI that does the work in a run, running on a chosen model.
_Avoid_: Bot, worker

**Model**:
The specific AI model an agent uses, chosen per ticket by label.
_Avoid_: Engine, LLM

**Sandbox**:
The isolated container where an agent works, so it cannot touch the host.
_Avoid_: VM, environment

**Verifier**:
The agent that checks a run's change and collects its evidence.
_Avoid_: Reviewer, tester

### Scheduling

**Dispatcher**:
The part that starts many runs at once and holds back the ones that must wait.
_Avoid_: Scheduler, queue

**Ticket graph**:
The map of which tickets depend on each other or would change the same files.
_Avoid_: Dependency tree, backlog order

### Setup

**Profile**:
A preset of defaults for a kind of project: personal or client.
_Avoid_: Mode, template

**Project**:
A repository Factory has been set up to work on.
_Avoid_: Repo, workspace

**Board**:
The live web page that shows every run across all projects.
_Avoid_: Dashboard, console
