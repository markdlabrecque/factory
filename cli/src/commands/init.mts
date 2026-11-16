// Initialize data-only project assets without overwriting, then register only after success.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Paths } from '../paths.mts';
import { scaffoldName } from '../paths.mts';
import { addProject, canonicalRoot, readRegistry } from '../projects.mts';
import { loadTomlConfig } from '../../../orchestrator/project-config.mts';
import { buildAssets, writeScaffold } from '../scaffold.mts';
import { requireProjectLayout } from '../../../orchestrator/project-layout.mts';
import type { PlannedFile, Profile, Settings } from '../scaffold.mts';

export type InitOptions = { profile?: string; repo?: string; image?: string; host?: string; 'project-id'?: string };
const SEGMENT = '[A-Za-z0-9_][A-Za-z0-9_.-]*';
const IMAGE = /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/;
const IGNORE = ['.env', 'evidence/', 'state/', 'logs/', 'board.html', 'worktrees/', 'node_modules/'];

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
  requireProjectLayout(root, 'init');
  readRegistry(p); // a malformed registry stops us before anything is written
  const files = hooks.assets ?? buildAssets(settings, p.state);
  const legacy = !existsSync(join(root, scaffoldName, 'factory.toml')) && ['config.mts','main.mts','dispatch.mts','dispatch.sh'].some(f => existsSync(join(root, scaffoldName, f)));
  if (legacy) throw new Error('Unsupported existing workflow without version 2 factory.toml; No conversion or adoption is performed.');
  const config = join(root, scaffoldName, 'factory.toml');
  if (existsSync(config) && lstatSync(config).isFile() && !lstatSync(config).isSymbolicLink()) loadTomlConfig(join(root, scaffoldName));
  const { created, skipped } = writeScaffold(root, files, { beforeWrite: hooks.beforeWrite });
  requireProjectLayout(root);
  const added = addProject(p, root);

  console.log(`Initialized ${join(root, scaffoldName)} (profile ${settings.profile})`);
  console.log(`Created ${created.length} file(s), skipped ${skipped.length} existing file(s).`);
  for (const f of skipped) console.log(`  skipped ${f}`);
  if (skipped.includes(`${scaffoldName}/.gitignore`)) {
    const have = new Set(readFileSync(join(root, scaffoldName, '.gitignore'), 'utf8').split('\n').map(l => l.trim()));
    const need = IGNORE.filter(e => !have.has(e));
    if (need.length) console.log(`Your existing ${scaffoldName}/.gitignore was not changed. Add: ${need.join(' ')}`);
  }
  console.log(`${added ? 'Registered' : 'Already registered:'} ${root}`);
  console.log(`Shared run state: ${p.state}.`);
  console.log([
    'Not ready to run an agent yet. Remaining steps:',
    `  1. Review labels, selection and merge policy in ${scaffoldName}/factory.toml.`,
    '  2. Log in to Pi with the OpenAI provider and authenticate your tracker CLI.',
    `  3. Provision image "${settings.image}" and sandbox.setup using the factory-setup skill.`,
    `  4. Check with: factory dispatch --project ${JSON.stringify(root)} --dry-run`,
  ].join('\n'));
}
