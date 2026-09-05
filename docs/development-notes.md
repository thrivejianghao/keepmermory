# Development Notes

## Phase 1: Monorepo initialization

Date: 2026-09-05

### Toolchain

- Node.js 24.19.0
- pnpm 11.19.0
- TypeScript 5.9.3
- ESLint 10.9.1
- Prettier 3.9.6
- Vitest 5.0.0

The repository requires Node.js 22.12 or newer. Dependency caches and temporary files are kept on
the E drive outside the repository.

### Verification

- Dependency install: PASS
- Format check: PASS
- TypeScript check: PASS
- ESLint: PASS
- Build: PASS
- Unit tests: PASS with no test files, because Phase 1 contains configuration and type declarations
  only
- Architecture review: PASS

### Environment findings

The existing `E:\nodejs\node.exe` exits abnormally on this machine. Phase 1 commands were verified
with the read-only Codex Node.js 24.19.0 runtime while keeping dependency and cache writes on E.

Docker CLI is not installed or available on `PATH`. It is not required for Phase 1, but Phase 2
database migrations and later Redis integration cannot be runtime-verified until Docker Desktop or
an equivalent MySQL 8 and Redis environment is available.
