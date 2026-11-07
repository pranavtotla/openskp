#!/usr/bin/env node
// Lays out the TypeScript package as an installable tree, for the `dist` branch.
//
//   node scripts/make-dist.mjs <target dir>
//
// npm installs a package from git only when it sits at the repository root, so this copy keeps
// the built package on a branch of its own, `dist` (see FORK.md). This script builds
// packages/typescript and writes that root into <target dir>:
//
//   package.json  the package's manifest without the fields that only matter for working on it
//                 (scripts, devDependencies, workspaces, overrides), so that installing it from
//                 git builds nothing and runs no lifecycle script
//   dist/         everything the build emitted
//   LICENSE, README.md
//
// It then runs `npm pack --dry-run --json` there and fails unless npm would pack exactly those
// files. <target dir> may be missing, empty, or an earlier layout such as a worktree of `dist`:
// its `.git` is left alone and the rest is replaced. A directory holding anything else is
// refused before anything is built. The script never commits or pushes.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_DIR = join(REPO_ROOT, 'packages', 'typescript');

/** Manifest fields the layout ships. They keep the order the source has them in. */
export const KEEP = [
  'name',
  'version',
  'description',
  'keywords',
  'homepage',
  'bugs',
  'license',
  'author',
  'repository',
  'main',
  'module',
  'types',
  'exports',
  'files',
  'sideEffects',
  'engines',
  'dependencies',
];

/** Manifest fields that only matter for working on the package. The layout leaves them out. */
export const DROP = ['scripts', 'devDependencies', 'workspaces', 'overrides'];

/**
 * Scripts npm runs by itself when it installs or packs a package. A git dependency with one of
 * them (or with workspaces) is also prepared first: its dependencies installed and it built.
 */
export const INSTALL_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  'prepack',
  'postpack',
  'build',
];

/** The top-level entries of a layout. */
export const LAYOUT = ['LICENSE', 'README.md', 'dist', 'package.json'];

/** What else a target may hold: the git checkout the layout lives in. */
export const LEFT_ALONE = ['.git'];

const quoteList = (items) => items.map((item) => `"${item}"`).join(', ');

/** The layout's manifest: the KEEP fields of `source`. Fails on a field in neither list. */
export function distManifest(source) {
  const unknown = Object.keys(source).filter((key) => !KEEP.includes(key) && !DROP.includes(key));
  if (unknown.length) {
    throw new Error(
      `package.json has ${quoteList(unknown)}, which make-dist doesn't know: ` +
        'add each to KEEP (to ship it) or to DROP (to leave it out) in scripts/make-dist.mjs',
    );
  }
  const missing = ['name', 'version'].filter((key) => typeof source[key] !== 'string' || !source[key]);
  if (missing.length) throw new Error(`package.json has no ${quoteList(missing)}`);
  return Object.fromEntries(Object.entries(source).filter(([key]) => KEEP.includes(key)));
}

/** Fails if npm would run a script by itself when installing `manifest` from git. */
export function assertInstallsWithoutScripts(manifest) {
  const scripts = Object.keys(manifest.scripts ?? {}).filter((name) => INSTALL_SCRIPTS.includes(name));
  if (scripts.length) {
    throw new Error(`the layout's package.json has ${quoteList(scripts)} scripts, which npm runs on install`);
  }
  if (manifest.workspaces) {
    throw new Error("the layout's package.json has workspaces, which make npm build a git dependency");
  }
}

/** The files `main`, `module`, `types` and `exports` point at, relative to the package. */
export function exportTargets(manifest) {
  const targets = new Set();
  const visit = (value) => {
    if (typeof value === 'string') targets.add(value.replace(/^\.\//, ''));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const field of ['main', 'module', 'types', 'exports']) visit(manifest[field]);
  return [...targets].sort();
}

/** Every file under `dir`, as sorted paths relative to it, with forward slashes. */
export function listFiles(dir) {
  const walk = (current) =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(current, entry.name))
        : [relative(dir, join(current, entry.name)).split(sep).join('/')],
    );
  return walk(dir).sort();
}

const isWithin = (child, parent) => {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

/**
 * The entries of `dir` a new layout replaces. A missing or empty directory is fine, and so is one
 * that holds only an earlier layout and `.git`. Anything else is refused, as is the package
 * folder, which the build rewrites.
 */
export function replaceableEntries(dir) {
  if (isWithin(resolve(dir), PACKAGE_DIR)) {
    throw new Error(`${dir} is inside packages/typescript, which the build rewrites: lay out elsewhere`);
  }
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  const entries = readdirSync(dir).sort();
  const foreign = entries.filter((entry) => !LAYOUT.includes(entry) && !LEFT_ALONE.includes(entry));
  if (foreign.length) {
    throw new Error(
      `${dir} holds ${quoteList(foreign)}, which no layout has: ` +
        'give make-dist a new or empty directory, or a checkout of the dist branch',
    );
  }
  return entries.filter((entry) => LAYOUT.includes(entry));
}

/** How npm's packed file list differs from the expected one; empty when they match. */
export function packListProblems(packed, expected) {
  const missing = expected.filter((file) => !packed.includes(file));
  const unexpected = packed.filter((file) => !expected.includes(file));
  return [...missing.map((file) => `missing ${file}`), ...unexpected.map((file) => `unexpected ${file}`)];
}

/** The package entry of `npm pack --json` output, and its file paths, sorted. */
export function packedFiles(stdout) {
  const result = JSON.parse(stdout);
  const entry = Array.isArray(result) ? result[0] : undefined;
  if (!entry || !Array.isArray(entry.files)) throw new Error('npm pack --json printed no file list');
  return { entry, files: entry.files.map((file) => file.path).sort() };
}

function run(command, args, cwd, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(' ')}\` failed in ${cwd} (exit ${result.status})`);
  }
  return result.stdout;
}

function sourceCommit() {
  const git = (...args) => spawnSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });
  const head = git('rev-parse', '--short', 'HEAD');
  if (head.status !== 0) return undefined;
  return { sha: head.stdout.trim(), dirty: git('status', '--porcelain').stdout.trim() !== '' };
}

/** Runs the script with its command-line arguments; returns the exit code. */
export function main(args) {
  if (args.length !== 1 || args[0].startsWith('-')) {
    console.error('usage: node scripts/make-dist.mjs <target dir>');
    return 2;
  }
  const target = resolve(args[0]);

  // Everything that can be checked without building is checked first.
  const replaced = replaceableEntries(target);
  for (const file of ['LICENSE', 'README.md']) {
    if (!existsSync(join(PACKAGE_DIR, file))) throw new Error(`packages/typescript/${file} is missing`);
  }
  if (!existsSync(join(PACKAGE_DIR, 'node_modules'))) {
    throw new Error('packages/typescript has no node_modules: run `npm ci` there first');
  }
  const manifest = distManifest(JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')));
  assertInstallsWithoutScripts(manifest);

  // The build upstream releases with, from a clean dist/ so that nothing an earlier build left
  // there ships. (Its postbuild also refreshes examples/web-viewer/dist, which git ignores.)
  rmSync(join(PACKAGE_DIR, 'dist'), { recursive: true, force: true });
  run('npm', ['run', 'build'], PACKAGE_DIR);
  const built = listFiles(join(PACKAGE_DIR, 'dist')).map((file) => `dist/${file}`);
  const unbuilt = exportTargets(manifest).filter((file) => !built.includes(file));
  if (unbuilt.length) throw new Error(`the build emitted no ${quoteList(unbuilt)}, which package.json points at`);

  mkdirSync(target, { recursive: true });
  for (const entry of replaced) rmSync(join(target, entry), { recursive: true, force: true });
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(join(PACKAGE_DIR, 'dist'), join(target, 'dist'), { recursive: true });
  for (const file of ['LICENSE', 'README.md']) cpSync(join(PACKAGE_DIR, file), join(target, file));

  const packed = run('npm', ['pack', '--dry-run', '--json', '--loglevel=error'], target, { capture: true });
  const { entry, files } = packedFiles(packed);
  const problems = packListProblems(files, ['LICENSE', 'README.md', 'package.json', ...built].sort());
  if (problems.length) throw new Error(`npm would pack a different set of files: ${problems.join(', ')}`);

  console.log(`\nmake-dist: ${entry.name}@${entry.version} laid out in ${target}`);
  for (const file of [...entry.files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    console.log(`  ${String(file.size).padStart(9)}  ${file.path}`);
  }
  console.log(`  npm pack --dry-run: ${files.length} files, shasum ${entry.shasum}`);
  const source = sourceCommit();
  if (source) {
    const note = source.dirty ? ' (with uncommitted changes, so this is no release build)' : '';
    console.log(`  built from ${source.sha}${note}`);
  }
  return 0;
}

function invokedDirectly() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false; // no script path, as when another module imports this one
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`make-dist: ${error.message}`);
    process.exitCode = 1;
  }
}
