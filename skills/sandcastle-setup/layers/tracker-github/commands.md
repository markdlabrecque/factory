# Command substitutions

`<ID>` is the issue number (the `#425` number).

LIST (replaces the sentinel `echo 'No issue tracker configured ...'; exit 1` expression):

    gh issue list --state open --label {{LABEL}} --limit 100 --json number,title,body,labels

VIEW (replaces the `<view command — see ...>` marker):

    gh issue view <ID> --comments

CLOSE (replaces the `<close command — see ...>` marker):

    gh issue comment <ID> --body "Completed by Sandcastle" && gh issue close <ID>
