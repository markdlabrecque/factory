# Historical GitHub command substitutions

These substitutions belong to the old copied-prompt setup. They are retained as examples, not instructions for the standard Factory workflow. Current Factory reads complete ticket context and performs tracker mutations on the host; sandbox agents receive frozen input without tracker credentials. Configure GitHub in v2 `factory.toml` and follow [environment setup](../../SKILL.md) rather than inserting these commands into shared prompts or automatically closing tickets from a sandbox. A complete custom override owns its own reviewed behavior.

`<ID>` is the issue number (the `#425` number).

LIST (replaces the sentinel `echo 'No issue tracker configured ...'; exit 1` expression):

    gh issue list --state open --label {{LABEL}} --limit 100 --json number,title,body,labels

VIEW (replaces the `<view command — see ...>` marker):

    gh issue view <ID> --comments

CLOSE (replaces the `<close command — see ...>` marker):

    gh issue comment <ID> --body "Completed by Sandcastle" && gh issue close <ID>
