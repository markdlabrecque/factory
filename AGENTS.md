<!-- Development policy: implementation runs through Factory; interactive sessions handle planning, tickets and documentation. GitHub tooling policy is below. -->

## GitHub tooling

Use `gh-axi` for ordinary GitHub API operations, including repositories, issues, PRs and comments. For screenshot/video attachment uploads, use plain `gh` with `--attach`, because `gh-axi` does not support attachments. An upload command may also create or update the comment containing those attachments. Keep other GitHub operations on `gh-axi`.

## Documentation

Update the authoritative documentation for the behavior changed, in the same change. Do not edit `README.md`, `orchestrator/ADAPTING.md` or `skills/sandcastle-setup/SKILL.md` merely because another file changed. Update them when their own instructions or claims become inaccurate. Keep the top-of-file responsibility comments accurate in touched source files; describe current behavior rather than appending ticket history. Include required documentation paths in the ticket footprint. Markdown files receive the same conflict protection as code.

Use this table to find the authoritative document, not as a list of mandatory edits.

| Behavior | Document |
| --- | --- |
| Operator CLI, recovery and scheduler contracts | `docs/factory-cli.md` |
| Configuration schema | `docs/project-config.md` |
| Workflow adaptation and complete overrides | `orchestrator/ADAPTING.md` |
| Environment and setup layers | `skills/sandcastle-setup/SKILL.md` |
| Test boundaries and commands | `TESTING.md` |
| Overview and quick start | `README.md` |

Dedicated feature references such as `docs/telemetry.md` can own their specific contracts. Add a navigation link when needed.
