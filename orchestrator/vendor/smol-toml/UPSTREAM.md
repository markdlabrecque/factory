# Vendored smol-toml

Pinned published npm release **smol-toml 1.9.1**, https://www.npmjs.com/package/smol-toml
(upstream https://github.com/squirrelchat/smol-toml). BSD-3-Clause license: `LICENSE`.
Published archive SHA-256: `4ac8392f1918c22a4366be19047cf53aa42646077d4c711b2ef73263beefb172`.

The unmodified ESM `dist/*.js`, upstream `package.json` (ESM scope), and license are
included. No install or network is needed at runtime. Upstream generated source is
kept unedited, including its copyright comments. Factory's `.gitattributes` disables
only trailing-space checks for these generated JS files so the published bytes stay intact.

To update: `npm pack smol-toml@<reviewed-version>` in a temporary directory, inspect
the package, replace these ESM files and license together, update this attribution,
and run Factory's parser, scaffold, copied-install and full fixture suites.
Do not replace this with a project-resolved npm import: shell validation happens
before project dependency installation.
