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
builds the workspace and starts the API plus the static Admin and H5 user servers together.

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

The API is available at `http://127.0.0.1:3000`, the Admin app at `http://127.0.0.1:3001`, and the
browser H5 user client at `http://127.0.0.1:3002`. The H5 covers skill discovery, local image upload,
AI model selection, task creation, result polling, download, and recent works. `WEB_PORT` can override
its port. Open `apps/miniapp` in the WeChat Developer Tools for the native Mini Program flow. For a
no-Docker mock run, skip the Docker and Prisma commands and run `pnpm dev`; the API defaults to the
in-memory database and queue and still executes the full image flow. `API_PORT` and `ADMIN_PORT` can
override the default ports.

### AI provider and model selection

Local development defaults to the server-side Mock provider, so no key is required:

```powershell
$env:AI_PROVIDER = 'mock'
pnpm dev
```

The H5 and Mini Program call `GET /api/v1/models`, show only available models, and send the selected
`providerId` and `modelId` when creating a task. The API stores those values on the task and passes them
through the worker and Skill Engine to the provider. Mock mode exposes `mock/image-default` and copies
the uploaded image to the output so the complete flow can be tested locally.

To expose all three real image providers in the H5 and Mini Program, configure their keys only in the
server environment before startup:

```powershell
$env:AI_PROVIDER = 'openai'
$env:OPENAI_API_KEY = 'your-server-side-key'
$env:OPENAI_MODEL = 'gpt-image-1'
$env:GEMINI_API_KEY = 'your-server-side-key'
$env:GEMINI_MODEL = 'gemini-2.5-flash-image'
$env:DASHSCOPE_API_KEY = 'your-server-side-key'
$env:QWEN_MODEL = 'qwen-image-edit-plus'
pnpm dev
```

`AI_PROVIDER` controls which configured provider is selected by default; the model selector can switch
between every configured provider. `QWEN_API_KEY` is accepted as an alias for `DASHSCOPE_API_KEY`.
The model variables are optional and use the values shown above by default.

For an OpenAI-compatible relay, set `OPENAI_BASE_URL=https://zjapi.com/v1`.
`OPENAI_API_BASE` is accepted as a legacy alias. A bare origin is normalized to `/v1`,
and trailing slashes are removed. Image edits, image generations, and analysis all use
this base URL. The relay key must have access to the selected **image** model;
access to text models alone does not grant access to `gpt-image-1`.

`scripts/start-local.mjs` loads the root `.env` before starting services. Values in
that file override inherited environment variables. Set a relay-specific key there
as `OPENAI_API_KEY`; `.env` is gitignored and no key is returned to the browser.
The checked-in `.env.example` contains placeholders only.

### Admin model configuration

Open `http://127.0.0.1:3001/` and select **模型配置**. Both the local static admin and
the React admin share the same settings form. Configure the default provider,
provider enablement, image model ID, endpoint, and API key for OpenAI, Gemini, and Qwen.
OpenAI takes an OpenAI-compatible base URL; Gemini takes its native API base URL;
Qwen takes the full DashScope generation endpoint. Changing the hostname does not
change the provider protocol.

The separate **Skill 编排模型** section accepts an OpenAI-compatible text model that
supports Chat Completions tool calling. For an Alibaba Cloud Bailian Token Plan, enter
the plan model ID, its dedicated API key, and
`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`. When enabled,
each task first asks this model to call `execute_image_skill`; the returned prompt is
then executed by the selected image provider. Qwen Image remains on the native
DashScope endpoint because Qwen image generation does not support compatible mode.

The same setting can be supplied through `SKILL_AGENT_API_KEY`,
`SKILL_AGENT_BASE_URL`, and `SKILL_AGENT_MODEL`. Admin settings override environment
defaults after they are saved.

Saving activates the configuration for new tasks without restarting the API.
Refresh the H5/Mini Program model list after saving. A blank key preserves the current
key; **清除密钥** explicitly removes it, including an inherited environment key.
The default real provider must be enabled and have a key. "Configured" means a key
exists, not that a paid image request or image-model permission has been verified.

Settings are persisted in `.local/model-config.json`, outside public image storage
and excluded from Git. `MODEL_CONFIG_FILE` can override the server-side path; never
place it under public storage or frontend directories. Saved settings override the
environment; unchanged environment keys are not copied into the settings file.
Keys entered in the admin are stored as local plaintext credentials, so protect this
directory with OS account permissions. They are never returned in GET/save responses,
stored in browser storage, or included in task records. This local-only configuration
endpoint checks loopback access, Host/Origin, JSON, and a custom request header. It is
not production authentication and must not be exposed through a public proxy.

The API uses a native HTTP transport fallback when Node runs with `--jitless`, because
its built-in fetch requires WebAssembly. Multipart serialization still uses the
standard Request/FormData implementation; redirected output downloads use the same
transport. Normal Node processes continue using the built-in fetch.

Verification: `node --jitless scripts/verify-model-config.mjs` exercises persistence,
validation, redaction, key clearing, write failures, the Skill agent tool call, and all
three image adapters against a local HTTP relay. `node --jitless scripts/verify-admin-models.mjs` checks the actual
admin save flow and desktop/mobile layout using the same Playwright setup as H5 QA.
Set `LIVE_ADMIN_URL=http://127.0.0.1:3001/` for an additional read-only check of the
running admin. Automated tests do not call paid image services.

The H5 polls a task for up to five minutes. A query timeout or disconnected API leaves
the task pending; the button resumes querying the same task. The task ID survives a
tab refresh without uploading or submitting again. Local in-memory task records are
lost when the API restarts, so an expired task must be submitted again.

Browser regression checks: `node scripts/verify-h5.mjs` (requires Playwright and Edge).
`PLAYWRIGHT_MODULE` can point to an existing Playwright `index.mjs`, and `H5_QA_OUTPUT`
can override the screenshot output directory. These checks mock external image calls.

Provider keys are never returned by the API, stored in a task, or sent to the H5/Mini Program. A model
without its corresponding server-side key is listed as unavailable and cannot be submitted.

### Admin Skill management

Open `http://127.0.0.1:3001/` and select **Skill 管理** to create, inspect, edit, publish,
take offline, or delete Skills. The editor manages the Skill identity, semantic version,
metadata, cover URL, input image limits, lifecycle status, sort order, and execution instructions.
New Skills use the generic Mock image-edit workflow until their manifest is extended outside the
editor; no Skill-specific branch is added to the engine.

Only `PUBLISHED` Skills are returned to H5 and Mini Program clients. Changes are applied to the
runtime registry immediately and persisted in `.local/skill-catalog.json`. Built-in source folders
under `skills/` are not physically modified or removed: local edits are stored as overlays and
deletions as tombstones, so they survive an API restart. A Skill referenced by an existing task
returns `SKILL_IN_USE` instead of deleting task history.

Run `node --jitless scripts/verify-skill-crud.mjs` for the API, persistence, publication, and Mock
execution checks. Run `node --jitless scripts/verify-admin-skills.mjs` with `PLAYWRIGHT_MODULE`
configured for the complete desktop/mobile browser workflow. Both tests use temporary E-drive data.

### WeChat Mini Program

The Mini Program source is under `apps/miniapp`. In WeChat Developer Tools, import that directory,
keep `urlCheck` disabled for local development, and run the local services first. The configured
development API is `http://127.0.0.1:3000/api/v1`; on a real phone, replace it in
`apps/miniapp/app.ts` with a LAN IP reachable by the phone. The browser H5 at port `3002` provides
the same user flow without requiring WeChat Developer Tools.

The native client follows `Page -> Service -> API`: pages never issue HTTP requests. The four
business services cover Skill discovery/manifest parameters, image selection/compression/upload,
task lifecycle/result conversion, and paginated works. The complete Mock flow supports dynamic
Skills, all manifest parameter types, multiple photos, upload progress, task retry states, result
preview/save with album-permission recovery, regeneration, and work deletion.

Run `node scripts/verify-miniapp-services.mjs` for the API client and business-service unit tests,
then `node scripts/verify-miniapp-integration.mjs` while the local API is running for the
`Skill -> Upload -> Task -> Worker -> Result -> Works -> Delete` integration test. On a machine with
damaged repository dependencies, point `TYPESCRIPT_CLI` to a verified TypeScript 5.9.3 CLI and keep
`MINIAPP_TEST_TMP`, `TEMP`, and `TMP` on E.

On the current Windows machine, use the existing bundled Node runtime read-only and keep the
working directory, caches, and logs on E. The E-drive Node and package-cache copies have failed
verification. To start the already-built application:

```powershell
Set-Location 'E:\codex-workspaces\ai-photo-skill-platform'
$env:TEMP = 'E:\codex-temp'
$env:TMP = 'E:\codex-temp'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --jitless scripts/start-local.mjs
```

## Verification commands

```bash
pnpm install
pnpm format:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

`pnpm test` verifies the OpenAI, Gemini, and Qwen request/response adapters, then runs an HTTP-level
local verification covering health, model discovery, multipart upload, Mock task execution, persisted
output, and Admin/H5 routing.

Because the current machine has damaged dependency copies, the latest build was verified using
TypeScript 5.9.3 downloaded to E and checked against the npm registry SHA-512 digest. The HTTP and
provider verification scripts use Node; browser verification uses the existing bundled Playwright
runtime read-only, with browser profiles and screenshots on E. No real image generation is performed
by the automated regression checks.

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
- `DELETE /api/v1/works/:taskId`
- `GET /api/v1/admin/skills` (local admin, `X-Admin-Config: 1`)
- `POST /api/v1/admin/skills` (create, JSON and `X-Admin-Config: 1`)
- `GET /api/v1/admin/skills/:id` (detail, `X-Admin-Config: 1`)
- `PUT /api/v1/admin/skills/:id` (update, JSON and `X-Admin-Config: 1`)
- `DELETE /api/v1/admin/skills/:id` (`X-Admin-Config: 1`)
- `GET /api/v1/admin/model-config` (local admin, `X-Admin-Config: 1`)
- `POST /api/v1/admin/model-config` (local admin, JSON and `X-Admin-Config: 1`)

All responses use `{ code, message, data }`.
