// Description-only tier resolution, frozen model choices and Pi provider utilities.

import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { AGENT_POLICY, MODEL_POLICY_ID, modelForRole, type ModelFamily, type ModelTier } from './model-policy.mts';
export type TierResolution = { declarations: string[]; revision: string } & ({ status: 'resolved'; tier: ModelTier; source: 'factory-default' | 'ticket-tier' } | { status: 'unsupported' | 'conflicting'; error: string });
import type { ModelResolution } from "./assessment.mts";

function indentedCode(line: string): boolean {
  let column = 0;
  for (const char of line) {
    if (char === ' ') column++;
    else if (char === '\t') column += 4 - column % 4;
    else break;
    if (column >= 4) return true;
  }
  return false;
}

/** Consume HTML delimiters in order, including when a comment began on an earlier line. */
function uncomment(raw: string, inside: boolean): { line: string; inside: boolean } {
  let line = '', offset = 0;
  while (offset < raw.length) {
    const delimiter = raw.indexOf(inside ? '-->' : '<!--', offset);
    if (delimiter < 0) {
      if (!inside) line += raw.slice(offset);
      break;
    }
    if (!inside) line += raw.slice(offset, delimiter);
    offset = delimiter + (inside ? 3 : 4);
    inside = !inside;
  }
  return { line, inside };
}

/** Standalone Model: / Pi model: fields, plain or Markdown-bold, outside code, quotes and comments. */
export function ticketModel(description: string, modelAliases: Record<string, string>): ModelResolution {
  const revision = createHash("sha256").update(description).digest("hex");
  const declarations: string[] = [];
  let fence: string | undefined, comment = false;
  for (const raw of description.split(/\r?\n/)) {
    // Fenced contents are literal: HTML comment markers inside them cannot change parser state.
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined;
      continue;
    }
    if ((indentedCode(raw) || /^ {0,3}>/.test(raw)) && !comment) continue;
    const rawOpening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (!comment && rawOpening && !(rawOpening[1][0] === "`" && rawOpening[2].includes("`"))) {
      fence = rawOpening[1];
      continue;
    }
    const visible = uncomment(raw, comment);
    const line = visible.line;
    comment = visible.inside;
    if (indentedCode(line)) continue;
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = opening[1];
      continue;
    }
    const field = /^\s{0,3}(?:\*\*(?:Pi\s+)?Model:\*\*|\*\*(?:Pi\s+)?Model\*\*:|(?:Pi\s+)?Model:)\s*(.*?)\s*$/i.exec(line);
    if (field) declarations.push(field[1]); // Legacy fields never choose a model.
  }
  const base = { declarations, revision };
  void modelAliases;
  return declarations.length
    ? { ...base, status: 'unsupported', error: 'Model and Pi model declarations are no longer supported. Use Model tier: small, mid or large.' }
    : { ...base, status: 'missing', error: 'Legacy model resolution is unsupported; use tier resolution.' };
}

/** Resolve only standalone tier fields in the current description. */
export function ticketTier(description: string): TierResolution {
  const revision = createHash("sha256").update(description).digest("hex");
  const declarations: string[] = [], legacy: string[] = [];
  let fence: string | undefined, comment = false;
  for (const raw of description.split(/\r?\n/)) {
    // Fenced contents are literal: HTML comment markers inside them cannot change parser state.
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined;
      continue;
    }
    if ((indentedCode(raw) || /^ {0,3}>/.test(raw)) && !comment) continue;
    const rawOpening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (!comment && rawOpening && !(rawOpening[1][0] === "`" && rawOpening[2].includes("`"))) {
      fence = rawOpening[1];
      continue;
    }
    const visible = uncomment(raw, comment);
    const line = visible.line;
    comment = visible.inside;
    if (indentedCode(line)) continue;
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = opening[1];
      continue;
    }
    const field = /^\s{0,3}(?:\*\*(?:Pi\s+)?Model:\*\*|\*\*(?:Pi\s+)?Model\*\*:|(?:Pi\s+)?Model:)\s*(.*?)\s*$/i.exec(line);
    if (field) legacy.push(field[1]);
    const tierField = /^\s{0,3}(?:\*\*Model\s+tier:\*\*|\*\*Model\s+tier\*\*:|Model\s+tier:)\s*(.*?)\s*$/i.exec(line);
    if (tierField) declarations.push(tierField[1]);
  }
  const base = { declarations, revision };
  if (legacy.length) return { ...base, status: 'unsupported', error: 'Model and Pi model declarations are no longer supported. Use Model tier: small, mid or large.' };
  if (!declarations.length) return { ...base, status: 'resolved', tier: 'mid', source: 'factory-default' };
  const tiers = declarations.map(d => d.trim().toLowerCase());
  if (tiers.some(d => !['small', 'mid', 'large'].includes(d))) return { ...base, status: 'unsupported', error: 'Model tier must be small, mid or large.' };
  if (new Set(tiers).size !== 1) return { ...base, status: 'conflicting', error: 'Conflicting Model tier declarations.' };
  return { ...base, status: 'resolved', tier: tiers[0] as ModelTier, source: 'ticket-tier' };
}

/** Pure assessment choice; callers may freeze this value independently of later refreshes. */
export function resolveTicketModel(description: string, family: ModelFamily): ModelResolution {
  const result = ticketTier(description);
  if (result.status !== 'resolved') return result;
  const model = modelForRole(family, 'implementation', result.tier).model;
  return { declarations: result.declarations, revision: result.revision, status: 'resolved', model,
    choice: { family, tier: result.tier, source: result.source, resolvedModel: model, descriptionRevision: result.revision, policyIdentity: MODEL_POLICY_ID } };
}

/** Configured models outside the allowlist, as an error message; undefined when all are allowed. */
export function disallowedModels(modelAliases: Record<string, string>, configured: string[]): string | undefined {
  const allowed = new Set(Object.values(modelAliases));
  if (!allowed.size) return undefined;
  const bad = configured.filter((m) => !allowed.has(m));
  return bad.length ? `model(s) ${bad.join(", ")} are not in AGENT.modelAliases (${[...allowed].join(", ")}); factory.toml (legacy: config.mts) may only use those.` : undefined;
}

// ---- Pi provider wiring ------------------------------------------------------------------------
// Models are "<pi provider>/<id>". The personal config uses the pi-claude-subscription provider, a Pi
// extension that runs `claude -p` on a Claude subscription. It is not part of Pi, so it must be loaded
// explicitly wherever Pi runs with extension discovery off (host analysis), and installed in the image.

export const SUBSCRIPTION_PROVIDER = "pi-claude-subscription";
/** The supported host install: a pi package install runs the package's husky `prepare` hook and fails. */
const INSTALL_HINT = "git clone --depth 1 --branch <tag> https://github.com/markdlabrecque/pi-claude-subscription.git ~/.pi/agent/extensions/pi-claude-subscription && cd ~/.pi/agent/extensions/pi-claude-subscription && npm ci --omit=dev --ignore-scripts";
export const isSubscriptionModel = (model: string) => model.startsWith(`${SUBSCRIPTION_PROVIDER}/`);

/** Where the provider extension's index.ts lives on the host. FACTORY_PI_SUBSCRIPTION_EXTENSION overrides. */
export function subscriptionExtensionPath(env: Record<string, string | undefined>): string {
  return env.FACTORY_PI_SUBSCRIPTION_EXTENSION || `${env.HOME || homedir()}/.pi/agent/extensions/${SUBSCRIPTION_PROVIDER}/index.ts`;
}

/**
 * Environment for a container Pi run. The subscription provider needs none from here: the image's Claude
 * Code CLI reads CLAUDE_CODE_OAUTH_TOKEN, which Sandcastle passes from .sandcastle/.env. Only an openai/
 * model (a custom config) gets a per-run OpenAI credential, minted lazily so it is never asked for otherwise.
 */
export function piEnvFor(model: string, openaiCredential: () => string): Record<string, string> {
  return model.startsWith("openai/") ? { OPENAI_API_KEY: openaiCredential() } : {};
}

/** Arguments for the read-only host analysis. Only the provider extension is loaded, by an explicit -e. */
export function piAnalysisArgs(model: string, env: Record<string, string | undefined>, exists: (path: string) => boolean): string[] {
  const args = ["-p", "--model", model, "--thinking", AGENT_POLICY.thinking, "--tools", "read,grep,find,ls", "--no-extensions", "--no-skills", "--no-context-files", "--no-session"];
  if (!isSubscriptionModel(model)) return args;
  const extension = subscriptionExtensionPath(env);
  if (!exists(extension)) throw new Error(`${SUBSCRIPTION_PROVIDER} extension not found at ${extension}. Install it (see orchestrator/ADAPTING.md) or set FACTORY_PI_SUBSCRIPTION_EXTENSION.`);
  return [...args, "-e", extension];
}

/** Host checks for the subscription provider; one message per problem, none when no model needs it. Never sees a credential. */
export function subscriptionPreflight(args: {
  models: string[];
  env: Record<string, string | undefined>;
  run: (cmd: string, args: string[]) => string;
  exists: (path: string) => boolean;
}): string[] {
  const used = [...new Set(args.models.filter(isSubscriptionModel))];
  if (!used.length) return [];
  const problems: string[] = [];
  const extension = subscriptionExtensionPath(args.env);
  if (!args.exists(extension)) {
    return [`${SUBSCRIPTION_PROVIDER} extension not found at ${extension}. Install it with: ${INSTALL_HINT}`];
  }
  try {
    if (!/"loggedIn":\s*true/.test(args.run("claude", ["auth", "status"]))) throw new Error("not logged in");
  } catch {
    problems.push("claude isn't logged in on the host. Run: claude auth login");
  }
  try {
    const listed = args.run("pi", ["--offline", "--no-extensions", "-e", extension, "--list-models", SUBSCRIPTION_PROVIDER]);
    for (const m of used) if (!listed.includes(m.slice(SUBSCRIPTION_PROVIDER.length + 1))) problems.push(`pi does not list ${m} from the provider; update the extension.`);
  } catch {
    problems.push(`pi could not load the ${SUBSCRIPTION_PROVIDER} extension from ${extension}.`);
  }
  return problems;
}
