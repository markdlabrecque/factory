// #137: new projects use TOML; repairing a legacy scaffold prints manual migration guidance.
// `factory init`: add the missing minimal Sandcastle workflow files to a Git project, then register it.
// #126: setup guidance names description model aliases, not tracker model labels.
// Never overwrites, never contacts a tracker, builds images or installs packages. A failed write leaves a
// repairable scaffold and does not register the project; rerun to fill the gaps.
// Self-recovery (#63): when this run created every recovery workflow file (recovery-review.mts WORKFLOW), the new copy is
// Factory's own workflow and init records it as reviewed, so recovery is active. If any of them already existed, it records
// nothing: recovery stays inactive until the developer upgrades the copy by hand and runs `factory recovery review --confirm`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from '../paths.mts';
import { scaffoldName } from '../paths.mts';
import { addProject, canonicalRoot, readRegistry } from '../projects.mts';
import { recordReview, WORKFLOW } from '../recovery-review.mts';
import { buildAssets, writeScaffold } from '../scaffold.mts';
import type { PlannedFile, Profile, Settings } from '../scaffold.mts';

export type InitOptions = { profile?: string; repo?: string; image?: string; host?: string; 'project-id'?: string };
const SEGMENT = '[A-Za-z0-9_][A-Za-z0-9_.-]*';
const IMAGE = /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/;
const IGNORE = ['.env', 'evidence/', 'state/', 'logs/', 'board.html'];

/** Validate every input before any write. */
export function validateInit(o: InitOptions): Settings {
  if (o.profile !== 'personal' && o.profile !== 'client') throw new Error('--profile personal|client is required');
  const profile: Profile = o.profile;
  if (!o.repo) throw new Error('--repo <namespace/project> is required');
  if (!o.image) throw new Error('--image <image> is required');
  const repoOk = profile === 'personal' ? new RegExp(`^${SEGMENT}/${SEGMENT}$`) : new RegExp(`^${SEGMENT}(?:/${SEGMENT})+$`);
  if (!repoOk.test(o.repo) || o.repo.split('/').some(x => x === '.' || x === '..' || x.endsWith('.git'))) {
    throw new Error(`Invalid --repo "${o.repo}": expected ${profile === 'personal' ? 'owner/repo' : 'namespace/project (subgroups allowed)'}`);
  }
  if (o.image.length > 255 || !IMAGE.test(o.image)) throw new Error(`Invalid --image "${o.image}": expected a lowercase Docker image name`);
  if (profile === 'personal') {
    if (o.host || o['project-id']) throw new Error('--host and --project-id apply to --profile client only');
    return { profile, repo: o.repo, image: o.image };
  }
  if (!o.host || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d+)?$/.test(o.host)) throw new Error('--profile client requires a valid --host <GitLab host>');
  if (!o['project-id'] || !/^[1-9]\d*$/.test(o['project-id'])) throw new Error('--profile client requires --project-id <positive integer>');
  return { profile, repo: o.repo, image: o.image, host: o.host, projectId: Number(o['project-id']) };
}

export async function init(p: Paths, path: string | undefined, options: InitOptions, hooks: { assets?: PlannedFile[]; beforeWrite?: (path: string, index: number) => void } = {}) {
  const settings = validateInit(options);
  const root = canonicalRoot(path ?? process.cwd());
  readRegistry(p); // a malformed registry stops us before anything is written
  const files = hooks.assets ?? buildAssets(settings, p.state);
  const legacy = !existsSync(join(root, scaffoldName, 'factory.toml')) && ['config.mts','main.mts','dispatch.mts','dispatch.sh'].some(f => existsSync(join(root, scaffoldName, f)));
  const { created, skipped } = writeScaffold(root, files, { beforeWrite: hooks.beforeWrite });
  const added = addProject(p, root);
  const fresh = WORKFLOW.every(f => created.includes(`${scaffoldName}/${f}`));
  if (fresh) recordReview(p, root, { by: 'init' });

  console.log(`Initialized ${join(root, scaffoldName)} (profile ${settings.profile})`);
  console.log(`Created ${created.length} file(s), skipped ${skipped.length} existing file(s).`);
  for (const f of skipped) console.log(`  skipped ${f}`);
  const custom = skipped.filter(f => /\/(config|main)\.mts$/.test(f));
  if (custom.length) {
    console.log(`Kept your existing ${custom.map(f => f.split('/').pop()).join(' and ')}: the flags configure new files only. Review ${custom.join(', ')} by hand; nothing was reconfigured.`);
  }
  if (skipped.includes(`${scaffoldName}/.gitignore`)) {
    const have = new Set(readFileSync(join(root, scaffoldName, '.gitignore'), 'utf8').split('\n').map(l => l.trim()));
    const need = IGNORE.filter(e => !have.has(e));
    if (need.length) console.log(`Your existing ${scaffoldName}/.gitignore was not changed. Add: ${need.join(' ')}`);
  }
  console.log(`${added ? 'Registered' : 'Already registered:'} ${root}`);
  console.log(`Shared run state: ${p.state} (the Factory board reads it; ${scaffoldName}/factory-dispatch.sh uses it).`);
  if (legacy) console.log('Legacy mode preserved: factory.toml was NOT created. Review workflow/helper upgrades and manually transcribe settings following orchestrator/ADAPTING.md before opting in.');
  const personal = settings.profile === 'personal';
  console.log([
    'Not ready to run an agent yet. Remaining steps:',
    '  1. In the project: npm install --save-dev @ai-hero/sandcastle tsx',
    `  2. Review the labels and merge policy in ${scaffoldName}/${legacy ? 'config.mts (legacy)' : 'factory.toml'}${personal ? ' (description model aliases: Sonnet 5.5, Opus 5.5)' : ''}.`,
    personal
      ? '  3. Host login: claude auth login, and install the pi-claude-subscription provider (git clone --depth 1 --branch <tag> https://github.com/markdlabrecque/pi-claude-subscription.git ~/.pi/agent/extensions/pi-claude-subscription, then npm ci --omit=dev --ignore-scripts there; see orchestrator/ADAPTING.md). Then run `claude setup-token` and put the token in .sandcastle/.env.'
      : '  3. Run `claude setup-token` and put the token in .sandcastle/.env; log in with `glab auth login`.',
    `  4. Provision image "${settings.image}" and the environment commands (sandbox.setup in factory.toml, separate scripts/prompts) with the sandcastle-setup skill.`,
    `  5. Check with: ${scaffoldName}/factory-dispatch.sh --dry-run`,
  ].join('\n'));
  console.log(fresh
    ? `Self-recovery: active for this new workflow. Editing ${WORKFLOW.join(', ')} later turns it off until you check the copy and run \`factory recovery review --confirm\`.`
    : 'Self-recovery: inactive. This project already had workflow files; upgrade them by hand (orchestrator/ADAPTING.md, "Upgrading an existing project for self-recovery"), then run `factory recovery review`.');
  if (!existsSync(join(root, scaffoldName, 'dispatch.sh'))) console.log('Warning: dispatch.sh is missing; rerun factory init.');
}
