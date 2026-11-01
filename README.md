# CopyServer — Discord Server Structure Manager

<p align="center">
  <strong>Developed by Lime Systems</strong><br />
  <em>Founder: detigone</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Refactor%20in%20progress-f0b232?style=for-the-badge" alt="Refactor in progress" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License" />
</p>

CopyServer is a client-side Discord community structure management project with Vencord and BetterDiscord plugin implementations and a web-based simulator.

The project focuses on **authorized, transparent migration of server configuration**. It must only operate on source information and destination resources the current Discord account is permitted to access and manage. It does not bypass Discord permissions or reveal inaccessible/private content.

## Project components

- **Vencord plugin** — `serverCloner/index.tsx`
- **BetterDiscord plugin** — generated distributable in the repository root
- **Web simulator** — React + TypeScript application in `src/`
- **Tests** — Node.js built-in test runner in `tests/`

## Current refactor

The `refactor/copyserver-2-core-audit` branch begins a reliability and maintainability pass. Existing implementations are preserved while the project moves toward:

1. A shared, platform-independent core for validation, migration planning, ID mapping and audit results.
2. Thin Vencord and BetterDiscord adapters.
3. A single source of truth for types, channel capabilities and permission mapping.
4. Tests that import production logic rather than reimplementing it.
5. Explicit dry-run previews, destination checks and destructive-action safeguards.
6. Accurate documentation and reproducible builds.

## Safety and permission model

- Source data must be obtained through supported client APIs and normal account permissions.
- A hidden channel is only eligible when the current account can read its metadata and the destination operator is authorized to recreate its access policy.
- The plugin must never try to evade role/channel access restrictions, extract credentials, or use stealth/evasion mechanisms.
- Never log authentication tokens, authorization headers, cookies or other secrets.
- Destructive destination operations require a clearly identified target, a preview, and explicit confirmation. A dry run must be the default.
- Permission failures are surfaced as failures; they must not be disguised by silently removing access controls or creating broader access than requested.

## Development

Requirements: Node.js compatible with the project's Vite toolchain.

```bash
npm install
npm run lint
npm test
npm run build
```

## Known project status

The historical README and package metadata previously advertised different versions. During this refactor, version numbers should only be changed as part of a tested release. The plugin files and the Vencord implementation must be validated independently against their host environments.

## License

MIT. See [LICENSE](LICENSE).
