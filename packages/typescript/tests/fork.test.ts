import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * What makes this repository a copy of openskp rather than upstream: the
 * package's metadata, its licence and its README note (see FORK.md at the
 * repository root). A merge from upstream that undoes one of them fails here.
 */

const PACKAGE_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.join(PACKAGE_DIR, '..', '..');
const COPY = 'https://github.com/pranavtotla/openskp';

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), 'utf8');
const pkg = JSON.parse(read(PACKAGE_DIR, 'package.json'));

describe('package metadata of this copy', () => {
  it("keeps upstream's name, licence and author", () => {
    expect(pkg.name).toBe('openskp');
    expect(pkg.license).toBe('MIT');
    expect(pkg.author).toBe('Ahsan Mehmood');
  });

  it('versions each build as an upstream release plus -fork.N', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+-fork\.\d+$/);
  });

  it('records the same version in package-lock.json', () => {
    const lock = JSON.parse(read(PACKAGE_DIR, 'package-lock.json'));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('points repository, bugs and homepage at this copy', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: `git+${COPY}.git`,
      directory: 'packages/typescript',
    });
    expect(pkg.bugs).toBe(`${COPY}/issues`);
    expect(String(pkg.homepage)).toMatch(/^https:\/\/github\.com\/pranavtotla\/openskp\//);
  });
});

describe('licence and README of this copy', () => {
  it('ships the root MIT licence in the package folder, unchanged', () => {
    expect(read(PACKAGE_DIR, 'LICENSE')).toBe(read(REPO_ROOT, 'LICENSE'));
  });

  it("says it is this copy before the README's first heading", () => {
    const readme = read(PACKAGE_DIR, 'README.md');
    const title = readme.search(/^# /m);
    expect(title).toBeGreaterThan(0);
    const note = readme.slice(0, title);
    expect(note).toContain('This is a copy of openskp');
    expect(note).toContain(COPY);
  });
});
