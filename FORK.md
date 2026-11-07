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
- `packages/typescript/tests/fork.test.ts`, which fails if a merge undoes any of the above.
- The fixes, each with its tests.

## Branches and tags

- `main` mirrors upstream's `main`. Nothing of this copy's is committed to it.
- `fork` is this copy's line: an upstream release plus the changes above. Changes reach it by
  merging, never by rebasing, so its history is never rewritten.
- `dist` holds the built package at the repository root, because npm installs a package from git
  only when it sits at the root. Each release is one commit on `dist`, tagged `dist-<version>`
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
   - Where upstream now fixes something this copy fixed too, take upstream's fix and drop ours.
3. In `packages/typescript`, run `npm ci`, then `npm run typecheck`, `npm run lint`, `npm test`
   and `npm run build`.
4. Re-run the corpus probe: read every real `.skp` file you depend on with the previous release
   and with the new build, and compare what each reads as (definitions, faces, edges, instances,
   layers and materials, or the error). Account for every difference before releasing.

## Tests that need real files

Tests that need SketchUp files beyond the fixtures in `packages/typescript/tests/fixtures` read
them from the folder `OPENSKP_CORPUS_DIR` names, and are skipped when it isn't set:

```sh
OPENSKP_CORPUS_DIR=/path/to/skp-files npm test
```

Those files are not part of this repository.
