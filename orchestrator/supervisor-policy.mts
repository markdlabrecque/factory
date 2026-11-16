// Import-safe supervisor ceilings and paid-call preflight. No state writer, scheduler, model invocation or action authority.
export type BudgetLimits = { maxTokens: number; maxCostUsd: number; maxCalls: number };
export type CallLimits = BudgetLimits & { timeoutSeconds: number };
export type SupervisorPolicy = { enabled: boolean; limits?: BudgetLimits & { diagnosis: CallLimits; review: CallLimits } };
export type SupervisorCallRole = 'diagnosis' | 'review';
export const SUPERVISOR_BOUNDS = Object.freeze({ diagnosesPerIncident: 2, timeoutSeconds: 600, activeDecisionsPerProject: 1 });
/** Totals include settled usage AND every outstanding reservation; no implicit period/reset. */
export type BudgetUsage = { tokens: number; costUsd: number; calls: number };
export type PaidCallInput = {
  registered: boolean; mode: 'observe' | 'act' | 'stopped'; globalAllowed: boolean;
  accountingKnown: boolean; pricingKnown: boolean;
  project: BudgetUsage; role: BudgetUsage;
  /** Host-owned worst-case charge, including all input/output and provider charges, reserved before spawn. */
  reservation: BudgetUsage;
  diagnosisCalls: number; activeDecisions: number;
};
const integer = (v: number) => Number.isSafeInteger(v) && v >= 0;
const amount = (v: number) => Number.isFinite(v) && v >= 0;
const usage = (v: BudgetUsage) => v && integer(v.tokens) && amount(v.costUsd) && integer(v.calls);
const cap = (v: BudgetLimits) => v && integer(v.maxTokens) && v.maxTokens > 0 && amount(v.maxCostUsd) && v.maxCostUsd > 0 && integer(v.maxCalls) && v.maxCalls > 0;
/** Pure necessary preflight, NOT admission or action approval. The journal owner must atomically
 * check these totals and reserve against project/global budgets + capacity under its fence.
 * Unknown final usage retains the reservation and holds subsequent calls. Never reset on mode/restart.
 */
export function supervisorCallHold(policy: SupervisorPolicy, role: SupervisorCallRole, input: PaidCallInput): string | undefined {
  if (policy?.enabled !== true || input?.registered !== true) return 'Supervisor disabled or project unregistered';
  if (input.mode !== 'act' || input.globalAllowed !== true) return 'Operator/global admission holds paid work';
  const limits = policy.limits, selected = limits?.[role];
  if (!limits || !selected || !cap(limits) || !cap(selected) || !Number.isSafeInteger(selected.timeoutSeconds) || selected.timeoutSeconds <= 0 || selected.timeoutSeconds > SUPERVISOR_BOUNDS.timeoutSeconds)
    return 'Finite supervisor limits required';
  if (selected.maxTokens > limits.maxTokens || selected.maxCostUsd > limits.maxCostUsd || selected.maxCalls > limits.maxCalls) return 'Role limits exceed project limits';
  if (input.accountingKnown !== true || input.pricingKnown !== true || !usage(input.project) || !usage(input.role) || !usage(input.reservation)
    || input.reservation.calls !== 1 || input.reservation.tokens <= 0 || input.reservation.costUsd <= 0)
    return 'Unknown pricing, usage or reservation; hold paid work';
  if (input.role.tokens > input.project.tokens || input.role.costUsd > input.project.costUsd || input.role.calls > input.project.calls)
    return 'Inconsistent accounting; hold paid work';
  if (!integer(input.activeDecisions) || input.activeDecisions >= SUPERVISOR_BOUNDS.activeDecisionsPerProject
    || !integer(input.diagnosisCalls) || input.diagnosisCalls > SUPERVISOR_BOUNDS.diagnosesPerIncident
    || role === 'diagnosis' && input.diagnosisCalls >= SUPERVISOR_BOUNDS.diagnosesPerIncident)
    return 'Incident or project decision bound reached/unknown';
  for (const [budget, spent] of [[limits, input.project], [selected, input.role]] as const) {
    if (spent.tokens + input.reservation.tokens > budget.maxTokens || spent.costUsd + input.reservation.costUsd > budget.maxCostUsd || spent.calls + 1 > budget.maxCalls)
      return 'Supervisor project or role budget exhausted';
  }
  return undefined;
}
