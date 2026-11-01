# CopyServer Core — architecture plan

## Goal

Extract deterministic, testable migration logic from the Vencord and BetterDiscord host plugins. The core must not know about either host's stores, UI framework, or REST wrapper.

## Target layout

```text
core/
  types.ts
  capabilities.ts
  permissions.ts
  validation.ts
  planning.ts
  mapping.ts
  audit.ts
  errors.ts
adapters/
  vencord/
  betterdiscord/
tests/
  core/
  adapters/
```

## Module contracts

- **types** — normalized source/destination resource shapes. IDs remain opaque strings; Discord permission bitfields remain decimal strings at API boundaries and use BigInt internally.
- **capabilities** — explicit resource support matrix. Unsupported thread-like and deprecated resource types are reported, not silently represented as successful copies.
- **permissions** — pure transformation and comparison of permission overwrites. Never widen access as a fallback. Permission errors remain visible and require operator intervention.
- **validation** — checks selected source/destination IDs, current access, destination manage permissions and operation settings before planning.
- **planning** — produces a deterministic plan with dependencies, expected objects, skipped objects and reasons. No API calls.
- **mapping** — records source-to-destination IDs and resolves parent/role references. Never match objects by name alone when a stable mapping exists.
- **audit** — compares planned and observed state; distinguishes created, matched, skipped, failed and verified.
- **errors** — typed errors with sanitized user-facing messages. Secrets and request headers must never enter logs.

## Safety invariants

1. Only resources returned by authorized, normal client APIs are eligible as sources.
2. No token extraction, permission bypass, hidden-channel discovery, stealth, jitter intended to evade detection, or rate-limit avoidance.
3. The destination must be explicitly selected and revalidated immediately before mutations.
4. Dry-run preview is the default. Destructive actions require a second explicit confirmation that names the destination.
5. A 401/403 is not converted into a weaker access policy or silently retried with stripped overwrites.
6. Rate limits are respected using the host's documented retry behavior; do not parallelize requests to outrun limits.
7. Partial failure is reported accurately. Never label a partially migrated destination as a full success.

## Refactor stages

### Stage 1 — establish a baseline
- Run existing tests, TypeScript check and web build.
- Record failures and current runtime constraints.
- Inspect duplicate distributables and build scripts.

### Stage 2 — extract pure core helpers
- Extract constants and pure mapping/planning/audit functions.
- Add tests importing the actual production modules.
- Keep host plugin behavior unchanged while extraction proceeds.

### Stage 3 — adapters
- Implement thin Vencord and BetterDiscord adapters over the same core contracts.
- Keep UI host-specific, but share validation and progress models.

### Stage 4 — reliability
- Add cancellation, resumable audit, operation IDs and bounded concurrency.
- Add idempotency checks to avoid duplicate destination resources.
- Persist only non-secret operation metadata.

### Stage 5 — release
- Reproducible builds for each supported host.
- Compatibility checks, changelog and installation docs.
- Test both distributables against the same fixtures.
