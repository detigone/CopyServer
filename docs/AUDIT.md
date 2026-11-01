# CopyServer — audit findings (2026-11-01)

## Confirmed repository facts

- Default branch: `master`; the audit/refactor work is isolated in `refactor/copyserver-2-core-audit`.
- The latest commit on master at audit time was `4164ec7` (2026-10-12).
- The repository contains a Vencord implementation at `serverCloner/index.tsx`, two BetterDiscord files with the exact same blob SHA, a React/Vite simulator, and a Node test file.
- The Vencord implementation is about 139 KB; the BetterDiscord distributable is about 95 KB.
- `tsconfig.json` originally used `strict: false`.
- The original test file contains 26 node:test declarations, but many helper implementations are copied into the test file rather than imported from production code.
- `build-and-inject.ps1` contains machine-specific absolute paths and modifies the local Vencord installation. It is not a portable build pipeline.
- `src/data/fullCode.ts` and `src/data/pluginSource.ts` are tiny stubs, while the UI imports distributable source constants from `src/data/fullCode`; this needs a specific review because the website may not actually be displaying/downloading the current committed plugin files.

## High-priority technical risks to resolve

1. **Authorization boundary:** ensure all data is obtained through supported client APIs available to the current user. Do not attempt to discover or retrieve inaccessible resources.
2. **Stealth/evasion logic:** remove randomized "human-like" delays and stealth framing. Keep only documented rate-limit compliance and bounded retry logic.
3. **Permission fallback:** never create a role/channel with weaker or broader access as a silent fallback after 401/403. Preserve intended policy or fail with a manual action.
4. **Dangerous destination purge:** default to dry-run; show destination name/ID and deletion counts; require explicit confirmation; re-check target immediately before each destructive batch; support cancellation.
5. **Idempotency:** use stable source-to-destination ID maps, not name/type only, to avoid collisions and duplicates.
6. **REST wrapper:** validate status extraction and retry-after units; avoid retrying non-idempotent POST unless the response is known not to have created the object.
7. **Tests:** import real core functions, and test host adapters separately with mocked transport.
8. **Distribution:** generate both distributables from source in CI; verify they contain the expected plugin metadata and share a release version.
9. **Portable tooling:** replace hard-coded Windows paths in build scripts with parameters and path discovery; avoid stopping Discord or overwriting installed files as part of a normal build.
10. **Type safety:** strict-check application code and progressively type plugin adapters.

## Changes already made on this branch

- Replaced README content with truthful project status and permission/safety constraints.
- Removed the unexplained `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` capability from `metadata.json`.
- Enabled `strict: true` in the web app's TypeScript config.
- Added `core/README.md` and `docs/ARCHITECTURE.md` defining the shared-core boundary and migration stages.
- Added `test:core` script for planned production core tests.

## Validation limitation

The GitHub connector can read and write repository files but cannot run npm, TypeScript, Vite, or Node tests in the repository workspace. Do not represent builds or tests as passing until they are run in CI or a local checkout.
