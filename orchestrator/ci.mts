// Shared CI gate for GitHub checks and GitLab jobs. Required names must pass, never skip.
// Input: the checks on a PR's head, each with the `bucket` from `gh pr checks --json bucket`
// (pass, fail, pending, skipping, cancel).
//   fail     any check failed or was cancelled
//   pending  any check is still running, or reports a bucket this code doesn't know
//   none     no checks, or every check was skipped: nothing ran, so nothing proved the change
//   pass     at least one check passed and every other one passed or was skipped
// Only "pass" lets Sandcastle merge. There is no timeout fallback to "pass".

export type Gate = "pass" | "fail" | "pending" | "none";

export function missingChecks(checks: { name?: string; bucket?: string }[], required: readonly string[]): string[] {
  return required.filter((name) => !checks.some((c) => c.name === name && c.bucket === "pass"));
}

export function ciGate(checks: { name?: string; bucket?: string }[], required: readonly string[] = []): Gate {
  if (checks.some((c) => c.bucket === "fail" || c.bucket === "cancel")) return "fail";
  if (checks.some((c) => c.bucket !== "pass" && c.bucket !== "skipping")) return "pending";
  if (missingChecks(checks, required).length) return checks.length ? "pending" : "none";
  return checks.some((c) => c.bucket === "pass") ? "pass" : "none";
}
