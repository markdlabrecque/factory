#!/usr/bin/env bash
# Opt-in isolated supplied-image smoke test; no configured image or service is touched.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
image="factory-browser-smoke-$(date +%s)-$$"
container="${image}-container"
trap 'docker rm -f "$container" >/dev/null 2>&1 || :; docker image rm -f "$image" >/dev/null 2>&1 || :' EXIT
docker build --build-arg AGENT_UID="$(id -u)" --build-arg AGENT_GID="$(id -g)" -t "$image" "$root/.sandcastle"
docker run --name "$container" --entrypoint /bin/sh "$image" -c '
set -eu
[ "$(id -u)" != 0 ]
command -v playwright
cd "$(mktemp -d)"
node <<'"'"'NODE'"'"'
const {execFileSync} = require("node:child_process");
const {join} = require("node:path");
const {statSync} = require("node:fs");
const {chromium} = require(join(execFileSync("npm", ["root", "-g"], {encoding:"utf8"}).trim(), "playwright"));
(async () => {
  const browser = await chromium.launch({headless:true, timeout:15000});
  try {
    const context = await browser.newContext({recordVideo:{dir:process.cwd()}});
    const page = await context.newPage();
    await page.setContent("<p id=marker>ready</p>");
    if (await page.locator("#marker").textContent() !== "ready") throw Error("marker");
    await page.screenshot({path:"proof.png"});
    const video = page.video();
    await context.close();
    if (!statSync("proof.png").size || !statSync(await video.path()).size) throw Error("empty evidence");
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
NODE
'
