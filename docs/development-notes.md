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

Phases 2–10 are implemented and covered by the HTTP E2E, queue/worker
integration, miniapp TypeScript, admin TypeScript/Vite, and eight-skill manifest checks. The local
database and Redis runtime are intentionally adapter-based until Docker is available.

### Final regression (2026-09-05)

- Root and package TypeScript build: PASS
- Admin Vite production build: PASS
- Mini Program TypeScript check: PASS
- Eight-skill validation: PASS
- HTTP upload-to-result E2E: PASS
- Queue/Worker integration: PASS
- Architecture forbidden-pattern and secret scan: PASS
- Git diff check: PASS

### Environment findings

The existing `E:\nodejs\node.exe` exits abnormally on this machine. Phase 1 commands were verified
with the read-only Codex Node.js 24.19.0 runtime while keeping dependency and cache writes on E.

Docker CLI is not installed or available on `PATH`. It is not required for Phase 1, but Phase 2
database migrations and later Redis integration cannot be runtime-verified until Docker Desktop or
an equivalent MySQL 8 and Redis environment is available.
