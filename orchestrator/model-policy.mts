// Factory-owned model mapping. This module performs no provider or credential checks.
export type ModelFamily = 'openai' | 'anthropic';
export type ModelTier = 'small' | 'mid' | 'large';
export type ModelRole = 'implementation' | 'analysis' | 'verification' | 'recovery' | 'supervisor' | 'gateReview';
export const MODEL_POLICY_ID = 'factory-model-policy-v2';
export const MODEL_POLICY = Object.freeze({
  openai: Object.freeze({ small: 'openai/gpt-6-luna', mid: 'openai/gpt-6.1-terra', large: 'openai/gpt-6.1-sol' }),
  anthropic: Object.freeze({ small: 'pi-claude-subscription/claude-haiku-5-5', mid: 'pi-claude-subscription/claude-sonnet-5-5', large: 'pi-claude-subscription/claude-opus-5-5' }),
});
export const ROLE_TIERS = Object.freeze({ analysis: 'mid', verification: 'large', recovery: 'large', supervisor: 'mid', gateReview: 'large' } as const);
export const AGENT_POLICY = Object.freeze({ agent: 'pi', thinking: 'high' } as const);
export const providerForFamily = (family: ModelFamily) => family === 'openai' ? 'openai' : 'pi-claude-subscription';
export function modelForRole(family: ModelFamily, role: ModelRole, implementationTier: ModelTier = 'mid') {
  const tier = role === 'implementation' ? implementationTier : ROLE_TIERS[role];
  return { family, tier, model: MODEL_POLICY[family][tier], provider: providerForFamily(family), ...AGENT_POLICY, policyIdentity: MODEL_POLICY_ID };
}
