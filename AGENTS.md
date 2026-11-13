<!-- Development policy: implementation runs through Factory; interactive sessions handle planning, tickets and documentation. GitHub tooling policy is below. -->

## GitHub tooling

Use `gh-axi` for ordinary GitHub API operations, including repositories, issues, PRs and comments. For screenshot/video attachment uploads, use plain `gh` with `--attach`, because `gh-axi` does not support attachments. An upload command may also create or update the comment containing those attachments. Keep other GitHub operations on `gh-axi`.

## Documentation

When you add or change any part of this repo, update the docs that describe it in the same change: `README.md`, `orchestrator/ADAPTING.md`, `skills/sandcastle-setup/SKILL.md`, and the comments at the top of the files you touched.
