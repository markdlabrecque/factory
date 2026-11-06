# Task

You are the VERIFIER for ticket #{{ISSUE_IID}}. A different agent implemented it on branch `{{BRANCH}}` (tip `{{TIP_SHA}}`), cut from `{{BASE_BRANCH}}` at `{{BASE_SHA}}`. Your job is to produce screenshot/video evidence of the behaviour and an honest verdict. You do NOT fix code.

## Ticket #{{ISSUE_IID}}: {{ISSUE_TITLE}}

{{TICKET}}

## Hard rules

- Never edit tracked files, never commit, never push, no `glab`. When you finish, `git status` must be clean and HEAD must be `{{TIP_SHA}}` on `{{BRANCH}}`.
- All output goes in `{{EVIDENCE_DIR}}` (a host-mounted folder). Nothing else leaves the sandbox.
- Data is synthetic. Create any content you need programmatically (`drush php:script`, `drush php:eval`; seeders in `tests/fixtures/`). Put your fixture script in `{{EVIDENCE_DIR}}/fixture.php` so the run is reproducible.
- Judge by what you actually SEE: open the PNGs with the Read tool. Do not claim a result you did not look at.

## Capture tool

`node /opt/sandcastle/evidence.cjs --label <before|after> --steps <steps.cjs> --out {{EVIDENCE_DIR}}`

`steps.cjs` is CommonJS: `module.exports = async ({ page, shot, login, baseUrl }) => { await login(); await page.goto(baseUrl + '/path'); await shot('descriptive-name'); };`

It records `<label>-<name>.png` (full page) and `<label>.webm` with a fixed 1280x800 viewport. Use ONE steps file for both labels so before and after are comparable. Take a screenshot at each state that proves the point; use video for interactive flows.

## Procedure

1. Decide: **bugfix** (existing behaviour was wrong) or **feature** (new behaviour). State which in the verdict.
2. Build fixtures, write `steps.cjs`.
3. **Bugfix:** check out the unfixed code, capture `before`, return to the fix, capture `after`:
   `git checkout --detach {{BASE_SHA}} && vendor/bin/drush cr` -> capture `before` -> `git checkout {{BRANCH}} && vendor/bin/drush updb -y && vendor/bin/drush cim -y && vendor/bin/drush cr` -> capture `after`.
   The `before` must visibly show the bug; if it does not reproduce, say so in the verdict.
   **Feature:** capture `after` only.
4. If a step fails or the evidence does not support the ticket, that is a FAIL or INCONCLUSIVE, not something to talk around.
5. Confirm `git status` is clean and `git rev-parse HEAD` is `{{TIP_SHA}}` (re-checkout `{{BRANCH}}` if needed).
6. Write `{{EVIDENCE_DIR}}/verdict.md`. First line EXACTLY one of `VERDICT: PASS`, `VERDICT: FAIL`, `VERDICT: INCONCLUSIVE`. Then: bugfix or feature; what was checked; what the before/after images show (name the files); anything the ticket asked for that you could not verify.

Then output:

<promise>COMPLETE</promise>
