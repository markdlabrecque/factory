<!-- Development policy: implementation runs through Factory; interactive sessions handle planning, tickets and documentation. -->
# Agents

## Development workflow

Run development implementation only through Factory, from a prepared ticket. Interactive sessions may investigate, plan, prepare tickets and edit documentation, but must hand code and test changes to Factory rather than implement them directly. If Factory cannot run the ticket, report the blocker instead of bypassing it with a local implementation or another agent runner.

For the planned self-recovery slice, read [the agreed design](docs/design/self-recovery.md). It is documentation only; prepare implementation tickets and run them through Factory before treating any recovery behavior as available.

## Documentation

When you add or change any part of this repo, update the docs that describe it in the same change: `README.md`, `orchestrator/ADAPTING.md`, `skills/sandcastle-setup/SKILL.md`, and the comments at the top of the files you touched.
