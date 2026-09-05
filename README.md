# AI Photo Skill Platform

Local MVP v0.1 for a skill-driven AI photo creation platform. The repository is being built
phase by phase from the product and engineering specifications.

## MVP status

The local MVP implementation now includes the complete mock-mode creation loop:

`upload -> skill discovery -> task -> queue -> worker -> skill engine -> provider -> local output -> result -> works`

The API uses a Node HTTP adapter so the loop can run without a database or external AI key in local
development. A Prisma schema, seed, and injectable Prisma database contract are included for a
MySQL deployment. The queue package includes a BullMQ producer contract; the default local queue is
an in-memory adapter so the mock loop remains runnable on a machine without Redis. `pnpm dev`
builds the workspace and starts the API plus a dependency-free static Admin server together.

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

## Run locally

```bash
pnpm install
docker compose up -d
pnpm prisma:generate
pnpm prisma:validate
pnpm prisma:seed
pnpm dev
```

The API is available at `http://127.0.0.1:3000`, and the Admin app at `http://127.0.0.1:3001`.
Open `apps/miniapp` in the WeChat Developer Tools. For a no-Docker mock run, skip the Docker and
Prisma commands and run `pnpm dev`; the API defaults to the in-memory database and queue and still
executes the full image flow. `API_PORT` and `ADMIN_PORT` can override the default ports.

## Verification commands

```bash
pnpm install
pnpm format:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

`pnpm test` runs an HTTP-level local verification that covers health, skill discovery, multipart
upload, Mock task execution, persisted output, and Admin SPA fallback routing.

Because the current machine has corrupted npm binary packages and no Docker CLI, the verification
performed for this checkout uses the clean TypeScript 6.0.3 runtime from the local development
environment and Node's built-in test runner. The application code itself does not depend on that
runtime location.

## API endpoints

- `GET /api/v1/skills`
- `GET /api/v1/skills/:id`
- `POST /api/v1/uploads` (`multipart/form-data`, field `file`)
- `GET /api/v1/files/:path`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks/:id`
- `GET /api/v1/tasks/:id/result`
- `POST /api/v1/tasks/:id/cancel`
- `GET /api/v1/works`

All responses use `{ code, message, data }`.
