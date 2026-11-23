# Develop and deploy the writing-tickets skill

[`skills/writing-tickets/`](../skills/writing-tickets/) is the tracked source for the portable skill. [`SKILL.md`](../skills/writing-tickets/SKILL.md) chooses the target workflow; the tracker references own filing mechanics. The [batch examples](../skills/writing-tickets/BATCH.md) use explicit Factory submission. [Separate acceptance preparation](../skills/writing-tickets/ACCEPTANCE.md) applies only when the target workflow requires it. The initial import and owner decision are recorded in [issue 314](https://github.com/markdlabrecque/factory/issues/314#issuecomment-7047100390).

## Three copies

| Copy | How it is updated |
| --- | --- |
| Tracked `skills/writing-tickets/` | Edit and review in the Factory checkout. |
| Factory app's bundled `skills/writing-tickets/` | A copied [Factory install](factory-cli.md#factory-install) bundles `skills/` from the selected source. A linked app uses the source checkout. |
| Pi-discovered `~/.agents/skills/writing-tickets/` | Sync explicitly. Reinstalling Factory does not register or update this independent copy. |

The `ticket-run-recovery` reference points to a separately installed sibling skill; syncing `writing-tickets` does not install that dependency.

## Explicit skill-only sync

From the reviewed Factory checkout, compare the tracked files with the installed copy. The Pi path below is for a user-level installation; for a copied Factory app, repeat with `dest="$HOME/.local/share/factory/app/skills/writing-tickets"` (or the app's actual install path). For a linked Factory app, update its source checkout instead. Do not patch a published runtime bundle under `runtimes/`.

```bash
src="$PWD/skills/writing-tickets"
dest="$HOME/.agents/skills/writing-tickets"
diff -ru "$dest" "$src"
```

Review the differences. Back up or reconcile local edits to the named files if you want to keep them. When you explicitly want the tracked versions to replace those files, run this block with `src` and `dest` as above. Check that the destination is your intended directory, not a link to another checkout or shared location. The sync preserves other files in that directory and other installed skills.

```bash
(
  set -e
  mkdir -p -- "$dest"
  for file in SKILL.md GITHUB.md GITLAB.md ACCEPTANCE.md BATCH.md; do
    if [ -L "$dest/$file" ] || { [ -e "$dest/$file" ] && [ ! -f "$dest/$file" ]; }; then
      printf 'Not a regular skill file: %s\n' "$dest/$file" >&2
      exit 1
    fi
  done
  for file in SKILL.md GITHUB.md GITLAB.md ACCEPTANCE.md BATCH.md; do
    cp -- "$src/$file" "$dest/$file"
    cmp -- "$src/$file" "$dest/$file"
  done
)
```

Start a new Pi session so skill discovery uses the updated description. To verify a change before deployment, walk through both tracker examples offline: check the issue body, hierarchy and blocker representation, then confirm the author hands off IDs without submitting them. This check does not run a batch or establish candidate acceptance.
