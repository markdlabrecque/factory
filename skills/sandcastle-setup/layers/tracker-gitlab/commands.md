# Command substitutions

`<ID>` is the issue IID (the `#425` number), not the global id.

LIST (replaces the sentinel `echo 'No issue tracker configured ...'; exit 1` expression):

    glab issue list --opened --label {{LABEL}} --per-page 100 --output json

VIEW (replaces the `<view command — see ...>` marker):

    glab issue view <ID> --comments

CLOSE (replaces the `<close command — see ...>` marker):

    glab issue note <ID> -m "Completed by Sandcastle" && glab issue close <ID>
