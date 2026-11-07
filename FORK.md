# This copy of openskp

This repository is a copy of [openskp](https://github.com/iamahsanmehmood/openskp), the
open-source SketchUp (`.skp`) reader and writer by Ahsan Mehmood. It carries fixes for SketchUp
files that upstream's TypeScript package doesn't read yet, so they can be used before upstream
ships them. Once an upstream release reads those files, prefer upstream `openskp`: this copy is a
bridge, not a new line of development.

- **Base:** upstream's `typescript-v1.5.0` release (commit `902ca80`).
- **Scope:** the TypeScript package, `packages/typescript`. The other ports (Python, .NET, Dart
  and C++) are upstream's, unchanged.
- **Licence:** MIT, as upstream's ([LICENSE](LICENSE)).

## What differs from upstream

- `packages/typescript/package.json`: the version is upstream's plus `-fork.N`
  (`1.5.0-fork.1` is this copy's first build of 1.5.0), and `repository`, `bugs` and
  `homepage` point here. The package name stays `openskp`.
- `packages/typescript/LICENSE`, a copy of the root licence, so the package carries it: npm packs
  a licence only from the package's own folder.
- A note at the top of `packages/typescript/README.md`, and this file.
- No release or Pages workflows: upstream's `release-*.yml` (one per port) and `deploy-pages.yml`
  are deleted, so nothing publishes a package, creates a GitHub release or deploys a site from
  this copy. The `ci-*.yml` workflows stay.
- `packages/typescript/tests/fork.test.ts`, which fails if a merge undoes any of the above.
- `scripts/make-dist.mjs`, which lays out the `dist` branch (see [Making a release](#making-a-release)),
  tested by `packages/typescript/tests/make-dist.test.ts`.
- The fixes, each with its tests.

## Branches and tags

- `main` mirrors upstream's `main`. Nothing of this copy's is committed to it.
- `fork` is this copy's line: an upstream release plus the changes above. Changes reach it by
  merging, never by rebasing, so its history is never rewritten.
- `dist` holds the built package at the repository root, because npm installs a package from git
  only when it sits at the root. `scripts/make-dist.mjs` lays it out from `fork`. Each
  release is one commit on `dist`, tagged `dist-<version>`
  (for example `dist-1.5.0-fork.1`). Depend on it as
  `"openskp": "github:pranavtotla/openskp#dist-<version>"`; the lockfile then pins the commit.
- Upstream's tag names (`typescript-v*`, and the other ports' prefixes) are upstream's. They are
  never created here.

## Taking upstream changes

1. Add upstream once (`git remote add upstream https://github.com/iamahsanmehmood/openskp.git`),
   then `git fetch upstream --tags`.
2. On `fork`, merge upstream's release tag: `git merge typescript-v<X.Y.Z>`.
   - Set the version to `<X.Y.Z>-fork.1`. In `packages/typescript`,
     `npm version <X.Y.Z>-fork.1 --no-git-tag-version` updates both `package.json` and
     `package-lock.json`.
   - Keep `repository`, `bugs` and `homepage` pointing here, and keep the README note.
   - Keep the release and Pages workflows deleted: resolve a modify/delete conflict on one with
     `git rm`, and delete any new `release-*.yml`.
   - Where upstream now fixes something this copy fixed too, take upstream's fix and drop ours.
3. In `packages/typescript`, run `npm ci`, then `npm run typecheck`, `npm run lint`, `npm test`
   and `npm run build`.
4. Re-run the corpus probe: read every real `.skp` file you depend on with the previous release
   and with the new build, and compare what each reads as (definitions, faces, edges, instances,
   layers and materials, or the error). Account for every difference before releasing.
5. Make a release.

## Making a release

1. On `fork`, with `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` and
   `npm run build` passing in `packages/typescript`, set the version there
   (`npm version <X.Y.Z>-fork.<N> --no-git-tag-version`) and commit it.
2. Check out `dist` in a worktree of its own, outside this one. The first time:
   `git worktree add --orphan -b dist ../openskp-dist`. After that:
   `git worktree add ../openskp-dist dist`.
3. From the repository root, run `node scripts/make-dist.mjs ../openskp-dist`. It builds the
   package with `npm run build`, then replaces everything in the worktree but `.git` with the
   layout: `package.json` without `scripts`, `devDependencies`, `workspaces` or `overrides`, then
   `dist/`, `LICENSE` and `README.md`, and nothing else. It fails unless `npm pack --dry-run`
   would pack exactly those files, and it never commits or pushes. If it stops at a
   `package.json` field it doesn't know, decide whether the installed package needs that field,
   and add it to `KEEP` or `DROP` in the script.
4. In `../openskp-dist`, commit everything (`git add -A`) with a message that names the
   `fork` commit it was built from (make-dist prints it), and tag that commit:
   `git tag dist-<version>`.
5. Push: `git push origin fork dist dist-<version>`.

## Tests that need real files

Tests that need SketchUp files beyond the fixtures in `packages/typescript/tests/fixtures` read
them from the folder `OPENSKP_CORPUS_DIR` names. A test is skipped when the variable isn't set or
the folder doesn't hold its file:

```sh
OPENSKP_CORPUS_DIR=/path/to/skp-files npm test
```

Those files are not part of this repository.
