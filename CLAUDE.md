# Project Guide for AI Assistants

This file instructs any AI assistant (Claude Code and others) working in this repository. **Follow it on every change.**

## Golden rules (non-negotiable)

1. **Always write tests when you add or update a feature.**
   - Add/extend **unit tests** (`*.spec.ts`) for any new or changed service, guard, interceptor, or other logic.
   - Add/extend **e2e tests** (`test/*.e2e-spec.ts`) when a change affects the HTTP contract (new route, auth/role rules, request/response shape).
   - A feature is **not complete** until its tests exist.

2. **Always run the tests and make them pass before considering work done.**
   - Run `pnpm test` (unit) and, when the HTTP layer changed, `pnpm test:e2e`.
   - Also run `pnpm lint`. Never finish with failing tests, lint errors, or a broken `pnpm build`.

3. **Always keep `README.md` in sync with the code.**
   - When you change behaviour, env variables, scripts, endpoints, the tech stack, or architecture, update the relevant README section in the **same change**.
   - The README must always reflect the current state of the project.

## How to work here

- **Architecture:** modular by feature under `src/modules`. Keep controllers thin; put business logic and persistence in services. Access the database only through `PrismaService`.
- **New feature module:** create `src/modules/<name>/` with `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/`, and `*.service.spec.ts`. Register the module in `app.module.ts`.
- **Database changes:** edit `prisma/schema.prisma`, then run `pnpm prisma:migrate` to create a migration and `pnpm prisma:generate`. Never hand-edit generated client code.
- **Auth/roles:** routes are protected by default. Use `@Public()` to open a route and `@Roles(Role.ADMIN, ...)` to restrict by role. Read the current user with `@CurrentUser()`.
- **Validation:** define request shapes as DTOs with `class-validator` decorators; the global `ValidationPipe` enforces them.
- **Config:** add new env vars to `src/config/configuration.ts`, `src/config/env.validation.ts`, and `.env.example` together.
- **Responses/errors:** rely on the global transform interceptor and exception filter — don't hand-roll response envelopes.

## Commands

```bash
pnpm install            # install deps
pnpm start:dev          # run in watch mode
pnpm test               # unit tests  (run for every change)
pnpm test:e2e           # e2e tests   (run for HTTP-facing changes)
pnpm lint               # lint + autofix
pnpm build              # type-check / compile
pnpm prisma:migrate     # create & apply a dev migration
pnpm prisma:generate    # regenerate the Prisma client
```

## Definition of done for any change

- [ ] Code follows the modular / service-layer conventions above.
- [ ] Unit tests written/updated and passing (`pnpm test`).
- [ ] E2e tests written/updated and passing when the HTTP contract changed (`pnpm test:e2e`).
- [ ] `pnpm lint` and `pnpm build` are clean.
- [ ] `README.md` updated to reflect the change.
