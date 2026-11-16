# Historical GitLab command substitutions

These substitutions belong to the old copied-prompt setup. They are retained as examples, not instructions for the standard Factory workflow. Current Factory reads complete ticket context and performs tracker mutations on the host; sandbox agents receive frozen input without tracker credentials. Configure GitLab in v2 `factory.toml` and follow [environment setup](../../SKILL.md) rather than inserting these commands into shared prompts or automatically closing tickets from a sandbox. A complete custom override owns its own reviewed behavior.

`<ID>` is the issue IID (the `#425` number), not the global id.

LIST (replaces the sentinel `echo 'No issue tracker configured ...'; exit 1` expression):

    glab issue list --opened --label {{LABEL}} --per-page 100 --output json

VIEW (replaces the `<view command — see ...>` marker):

    glab issue view <ID> --comments

CLOSE (replaces the `<close command — see ...>` marker):

    glab issue note <ID> -m "Completed by Sandcastle" && glab issue close <ID>
