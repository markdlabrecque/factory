<!-- Current self-recovery design entry point. Detailed operator and safety contracts live in factory-cli.md; the original prompt draft and acceptance map are historical records. -->
# Self-recovery

Status: implemented. The scheduler confirms eligible jams after two consecutive completed passes, prepares current execution analysis and launches bounded repairs on recorded ticket work. Recovery shares normal independent verification and exact-tip delivery gates. It preserves saved work and evidence, spends at most two attempts per unchanged ticket budget, and retains ownership until exact-container cleanup is confirmed.

## Current contracts

The [CLI recovery reference](../factory-cli.md#slice-four-self-recovery-requirements) is authoritative. It covers:

- [Durable episodes, budgets and renewal](../factory-cli.md#slice-four-recovery-state).
- [Recorded branch/worktree ownership and remote-only branches](../factory-cli.md#slice-four-resuming-recorded-work).
- [Shared independent verification and delivery](../factory-cli.md#slice-four-shared-verification-and-delivery).
- [Current execution-analysis preparation](../factory-cli.md#recovery-execution-analysis-preparation).
- [Bounded repair execution, cancellation and settlement](../factory-cli.md#slice-four-bounded-repair-attempts).
- [Persistent deferred-work follow-through](../factory-cli.md#persistent-deferred-recovery-follow-through).
- [Status and explicit reset](../factory-cli.md#slice-four-recovery-status-and-reset).

The selected complete runtime supplies `orchestrator/prompt.recover.md`. Default Factory-mode recovery needs no per-project executable review. A complete project override requires a current host-owned review of its source, dependency and location identity; changed inputs invalidate review. `factory init` creates data-only assets, not copied recovery code or prompts. See [workflow selection](../execution-context.md#workflow-selection) and [override maintenance](../../orchestrator/ADAPTING.md#complete-project-workflow-override).

Host filesystem gates run before new launch/charge. The standard workflow also requires complete frozen ticket input, image capability readiness and a prepared-sandbox probe under the actual agent UID/GID. A pre-charge environment hold spends no repair attempt; a sandbox setup failure after admission keeps its charge. Settlement of already-owned resources continues even while new work is held. See [ticket readiness](../ticket-readiness.md) and [image readiness](../image-readiness.md).

## Design history and verification

The [original prompt draft](self-recovery-prompt.md) is historical, not an installed template. The [original bounded-repair acceptance map](../recovery-60-verification.md) records the earlier implementation and closed gaps; current contracts above supersede its copied-workflow assumptions. Offline coverage and trusted external boundaries are documented in [TESTING.md](../../TESTING.md).

A dedicated recovery Board interface remains deferred. Operators use `factory recovery status`, `factory logs --recovery`, `factory recovery review` for project overrides and explicit `factory recovery reset`. Reset does not erase work, launch a repair or bypass fresh jam confirmation.
