# Architecture Baseline

## Dependency direction

```text
Mini Program / Admin -> API -> Task Service -> Queue
                                      Worker -> Skill Engine -> Provider Manager -> AI Provider
                                                           -> Storage Provider
                                                           -> Repository -> Database
```

Controllers validate transport input and call services. They do not access Prisma, files, or AI
providers. Skills describe behavior through manifests, prompts, and workflows; they do not call
HTTP services, databases, storage, or provider SDKs.

## Extension rules

- Skills are discovered from `skills/*`; core code must not branch on a skill identifier.
- AI integrations implement the shared provider contract and are selected by provider metadata.
- Storage consumers depend on `StorageProvider`, not a filesystem implementation.
- Application frontends access backend behavior through services, never provider or database code.
- Secrets stay in environment variables and must not be logged or committed.

## Phase 1 review

- Skill Isolation: PASS, workspace boundary reserved with no application coupling.
- Provider Isolation: PASS, dedicated package boundary reserved.
- Database Layer: PASS, dedicated package boundary reserved.
- Frontend Separation: PASS, admin and miniapp are separate applications.
- Duplication: PASS, shared behavior has a dedicated package boundary.
- Dependency Hygiene: PASS, only repository-wide development tooling is installed.
