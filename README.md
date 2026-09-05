# AI Photo Skill Platform

Local MVP v0.1 for a skill-driven AI photo creation platform. The repository is being built
phase by phase from the product and engineering specifications.

## Phase 1 status

The pnpm workspace, strict TypeScript baseline, ESLint, Prettier, test runner, repository
boundaries, and E-drive storage directories are initialized.

## Repository boundaries

- `apps/api`: NestJS HTTP API.
- `apps/worker`: BullMQ worker process.
- `apps/admin`: React and Ant Design administration app.
- `apps/miniapp`: native WeChat Mini Program.
- `packages/database`: Prisma schema, client, and repositories.
- `packages/skill-engine`: skill loading, validation, registration, and execution.
- `packages/ai-provider`: provider contracts and adapters.
- `packages/storage`: storage abstraction and local implementation.
- `packages/shared`: shared contracts with no application-specific behavior.
- `skills`: dynamically discovered creative skills.

## Phase 1 commands

```bash
pnpm install
pnpm format:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

The complete local runbook will be added as the database, queue, API, worker, admin, and
miniapp phases become runnable.
