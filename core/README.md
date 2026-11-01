# CopyServer Core — refactor boundary

This directory is the target boundary for shared, platform-independent migration logic.

## Planned modules

- `types.ts`: normalized guild, role, channel and permission types.
- `capabilities.ts`: supported resource capabilities and explicit unsupported cases.
- `validation.ts`: source/destination access and configuration validation.
- `planning.ts`: deterministic migration plan; no network or mutation side effects.
- `mapping.ts`: source-to-destination ID mapping.
- `audit.ts`: compare the plan with observed destination state.
- `errors.ts`: typed errors and safe error serialization.

## Contract

Core modules must not import Vencord, BetterDiscord, React, Discord stores, or host-specific REST clients. Adapters provide authorized data and execution functions. The core never discovers credentials or attempts to bypass access controls.

## Migration order

1. Extract pure helpers from the existing Vencord and BetterDiscord implementations.
2. Make both adapters call the shared helpers.
3. Replace duplicated test fixtures with tests importing production modules.
4. Add host-specific integration tests and release checks.
