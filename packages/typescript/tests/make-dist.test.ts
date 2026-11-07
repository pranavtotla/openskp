import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DROP,
  INSTALL_SCRIPTS,
  KEEP,
  PACKAGE_DIR,
  REPO_ROOT,
  assertInstallsWithoutScripts,
  distManifest,
  exportTargets,
  listFiles,
  packListProblems,
  packedFiles,
  replaceableEntries,
} from '../../../scripts/make-dist.mjs';

/**
 * scripts/make-dist.mjs lays out this package for the `dist` branch, the
 * root of which npm installs from git (see FORK.md). The layout must hold
 * exactly package.json, LICENSE, README.md and the built dist/ files, and
 * its package.json must give npm nothing to build or run on install.
 */

const SCRIPT = path.join(REPO_ROOT, 'scripts', 'make-dist.mjs');
const source = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));

const scratch: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openskp-make-dist-'));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe('distManifest', () => {
  it('ships every field of the real package.json except the development ones', () => {
    const manifest = distManifest(source);
    expect(Object.keys(manifest)).toEqual(Object.keys(source).filter((key) => !DROP.includes(key)));
    for (const key of Object.keys(manifest)) expect(manifest[key], key).toEqual(source[key]);
    for (const key of DROP) expect(manifest).not.toHaveProperty(key);
  });

  it('drops scripts, devDependencies, workspaces and overrides', () => {
    const manifest = distManifest({
      name: 'x',
      version: '1.0.0',
      scripts: { prepare: 'tsup', test: 'vitest' },
      devDependencies: { tsup: '^9.0.0' },
      workspaces: ['packages/*'],
      overrides: { esbuild: '^0.28.1' },
      dependencies: { earcut: '^3.1.0' },
    });
    expect(manifest).toEqual({ name: 'x', version: '1.0.0', dependencies: { earcut: '^3.1.0' } });
  });

  it('keeps every KEEP field, in the order the source has them', () => {
    const reversed = [...KEEP].reverse();
    const all = Object.fromEntries(reversed.map((key) => [key, `the ${key}`]));
    expect(Object.keys(distManifest(all))).toEqual(reversed);
  });

  it('refuses a field it does not know, naming it and where to add it', () => {
    expect(() => distManifest({ ...source, type: 'module' })).toThrow(
      /"type", which make-dist doesn't know: add each to KEEP .* or to DROP/,
    );
  });

  it('names every unknown field at once', () => {
    expect(() => distManifest({ ...source, bin: './cli.js', gypfile: true })).toThrow(/"bin", "gypfile"/);
  });

  it('refuses a manifest without a name or a version', () => {
    expect(() => distManifest({ version: '1.0.0' })).toThrow(/no "name"/);
    expect(() => distManifest({ name: 'x' })).toThrow(/no "version"/);
    expect(() => distManifest({ name: '', version: '' })).toThrow(/no "name", "version"/);
  });
});

describe('assertInstallsWithoutScripts', () => {
  it("accepts the layout's manifest", () => {
    expect(() => assertInstallsWithoutScripts(distManifest(source))).not.toThrow();
  });

  it('accepts scripts npm never runs by itself', () => {
    expect(() => assertInstallsWithoutScripts({ scripts: { test: 'vitest', lint: 'eslint src/' } })).not.toThrow();
  });

  it.each(INSTALL_SCRIPTS)('refuses a %s script', (name) => {
    expect(() => assertInstallsWithoutScripts({ scripts: { [name]: 'node x.js' } })).toThrow(`"${name}"`);
  });

  it('refuses workspaces, which make npm build a git dependency', () => {
    expect(() => assertInstallsWithoutScripts({ workspaces: ['packages/*'] })).toThrow(/workspaces/);
  });
});

describe('exportTargets', () => {
  it('lists the files the real package.json points at', () => {
    expect(exportTargets(source)).toEqual(['dist/index.d.ts', 'dist/index.js', 'dist/index.mjs']);
  });

  it('walks nested conditions and fallback arrays, and skips null subpaths', () => {
    const manifest = {
      main: 'lib/a.js',
      exports: {
        '.': {
          node: { import: './lib/b.mjs', require: './lib/a.js' },
          default: ['./lib/c.js', './lib/d.js'],
        },
        './internal': null,
      },
    };
    expect(exportTargets(manifest)).toEqual(['lib/a.js', 'lib/b.mjs', 'lib/c.js', 'lib/d.js']);
  });

  it('reads an exports field that is a single path', () => {
    expect(exportTargets({ exports: './index.js' })).toEqual(['index.js']);
  });

  it('is empty for a manifest without entry points', () => {
    expect(exportTargets({ name: 'x' })).toEqual([]);
  });
});

describe('listFiles', () => {
  it('lists nested files as sorted forward-slash paths, and no directories', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'b', 'c'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'empty'));
    fs.writeFileSync(path.join(dir, 'b', 'c', 'd.js'), '');
    fs.writeFileSync(path.join(dir, 'a.js'), '');
    expect(listFiles(dir)).toEqual(['a.js', 'b/c/d.js']);
  });
});

describe('replaceableEntries', () => {
  it('accepts a directory that does not exist yet, or an empty one', () => {
    const dir = tempDir();
    expect(replaceableEntries(path.join(dir, 'new'))).toEqual([]);
    expect(replaceableEntries(dir)).toEqual([]);
  });

  it('replaces an earlier layout and leaves .git alone', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /elsewhere\n');
    for (const file of ['package.json', 'LICENSE', 'README.md']) fs.writeFileSync(path.join(dir, file), '');
    fs.mkdirSync(path.join(dir, 'dist'));
    expect(replaceableEntries(dir)).toEqual(['LICENSE', 'README.md', 'dist', 'package.json']);
  });

  it('refuses a directory holding anything else, naming what', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'package.json'), '');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n');
    fs.writeFileSync(path.join(dir, 'notes.txt'), '');
    expect(() => replaceableEntries(dir)).toThrow(/holds "\.gitignore", "notes\.txt", which no layout has/);
  });

  it('refuses the package folder and anything inside it', () => {
    expect(() => replaceableEntries(PACKAGE_DIR)).toThrow(/inside packages\/typescript/);
    expect(() => replaceableEntries(path.join(PACKAGE_DIR, 'dist', 'layout'))).toThrow(/inside packages\/typescript/);
  });

  it('refuses the repository root, which holds much more than a layout', () => {
    expect(() => replaceableEntries(REPO_ROOT)).toThrow(/which no layout has/);
  });

  it('refuses a file', () => {
    const file = path.join(tempDir(), 'file');
    fs.writeFileSync(file, '');
    expect(() => replaceableEntries(file)).toThrow(/is not a directory/);
  });
});

describe('packListProblems', () => {
  it('is empty when npm packs exactly the expected files', () => {
    expect(packListProblems(['LICENSE', 'dist/index.js'], ['LICENSE', 'dist/index.js'])).toEqual([]);
  });

  it('names missing and unexpected files', () => {
    expect(packListProblems(['LICENSE', '.npmignore'], ['LICENSE', 'README.md'])).toEqual([
      'missing README.md',
      'unexpected .npmignore',
    ]);
  });
});

describe('packedFiles', () => {
  it('reads the package entry and its sorted file paths from npm pack --json', () => {
    const entry = { name: 'openskp', version: '1.0.0', files: [{ path: 'b.js' }, { path: 'a.js' }] };
    const { entry: read, files } = packedFiles(JSON.stringify([entry]));
    expect(read.name).toBe('openskp');
    expect(files).toEqual(['a.js', 'b.js']);
  });

  it('fails on output without a file list', () => {
    expect(() => packedFiles('[]')).toThrow(/no file list/);
    expect(() => packedFiles('{}')).toThrow(/no file list/);
    expect(() => packedFiles('[{"name":"openskp"}]')).toThrow(/no file list/);
  });
});

describe('make-dist, run as a script', () => {
  const runScript = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('prints its usage and exits 2 unless given exactly one target', () => {
    for (const args of [[], ['a', 'b'], ['--help']]) {
      const result = runScript(...args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('usage: node scripts/make-dist.mjs <target dir>');
    }
  });

  it('refuses a directory holding anything else before building, and leaves it as it was', () => {
    const target = tempDir();
    fs.writeFileSync(path.join(target, 'notes.txt'), 'mine');
    const result = runScript(target);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('make-dist: ');
    expect(result.stderr).toContain('"notes.txt"');
    expect(result.stdout).not.toContain('Build success');
    expect(fs.readdirSync(target)).toEqual(['notes.txt']);
    expect(fs.readFileSync(path.join(target, 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('lays out exactly what npm packs, replacing an earlier layout and keeping .git', () => {
    const target = tempDir();
    fs.writeFileSync(path.join(target, '.git'), 'gitdir: /elsewhere\n');
    fs.mkdirSync(path.join(target, 'dist'));
    fs.writeFileSync(path.join(target, 'dist', 'stale.js'), '');
    fs.writeFileSync(path.join(target, 'README.md'), 'an older README');

    const result = runScript(target);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`make-dist: openskp@${source.version} laid out in`);

    expect(fs.readFileSync(path.join(target, '.git'), 'utf8')).toBe('gitdir: /elsewhere\n');
    const files = listFiles(target).filter((file: string) => file !== '.git');
    expect(files).toEqual([
      'LICENSE',
      'README.md',
      'dist/index.d.mts',
      'dist/index.d.ts',
      'dist/index.js',
      'dist/index.mjs',
      'package.json',
    ]);

    const shipped = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
    expect(shipped).toEqual(distManifest(source));
    expect(() => assertInstallsWithoutScripts(shipped)).not.toThrow();
    expect(fs.readFileSync(path.join(target, 'LICENSE'), 'utf8')).toBe(
      fs.readFileSync(path.join(REPO_ROOT, 'LICENSE'), 'utf8'),
    );
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).toBe(
      fs.readFileSync(path.join(PACKAGE_DIR, 'README.md'), 'utf8'),
    );
    for (const file of files.filter((f: string) => f.startsWith('dist/'))) {
      const same = fs.readFileSync(path.join(target, file)).equals(fs.readFileSync(path.join(PACKAGE_DIR, file)));
      expect(same, file).toBe(true);
    }
  }, 180_000);
});
