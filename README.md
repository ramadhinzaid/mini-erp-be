# Mini ERP — Backend

A production-oriented [NestJS](https://nestjs.com/) starter for a Mini ERP system. It is built to be **scalable, modular, and maintainable**, with a clean service-layer separation that makes it straightforward to extract individual modules into standalone microservices later.

---

## Tech Stack

| Concern              | Choice                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| Language / Runtime   | TypeScript, Node.js 20+                                                 |
| Framework            | NestJS 11 (modular architecture, dependency injection)                 |
| Database             | PostgreSQL                                                             |
| ORM                  | Prisma                                                                  |
| Authentication       | JWT (access + refresh) via `@nestjs/passport` + `passport-jwt`         |
| Authorization        | Role-based access control (RBAC) with a global guard                   |
| Password hashing     | bcrypt                                                                  |
| Validation           | `class-validator` / `class-transformer` (global `ValidationPipe`)      |
| Config               | `@nestjs/config` with Zod schema validation (fail-fast on boot)        |
| API Documentation    | Swagger / OpenAPI (`@nestjs/swagger`)                                   |
| Health checks        | `@nestjs/terminus` (database ping)                                     |
| Security             | Helmet, CORS                                                            |
| Testing              | Jest (unit) + Supertest (e2e)                                          |
| Tooling              | ESLint, Prettier, pnpm                                                 |

---

## Prerequisites

- **Node.js** `>= 20`
- **pnpm** `>= 9` (`corepack enable` will provide it)
- **PostgreSQL** `>= 14` — either a local install or via the provided Docker Compose file
- **Docker** (optional, recommended for the local database)

---

## Installation

```bash
# 1. Install dependencies
pnpm install

# 2. Create your environment file and adjust the values
cp .env.example .env

# 3. Start a local PostgreSQL instance (optional — skip if you already have one)
docker compose up -d

# 4. Generate the Prisma client
pnpm prisma:generate

# 5. Apply database migrations (creates tables)
pnpm prisma:migrate

# 6. (Optional) Seed an initial admin user
pnpm db:seed
```

> The seed command creates an admin using `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
> (defaults: `admin@mini-erp.local` / `ChangeMe123!`). Change these before any real deployment.

### Environment variables

All variables are validated at startup (see `src/config/env.validation.ts`); the app refuses to boot if any are missing or malformed.

| Variable                 | Description                                  | Default                   |
| ------------------------ | -------------------------------------------- | ------------------------- |
| `NODE_ENV`               | `development` \| `test` \| `production`      | `development`             |
| `PORT`                   | HTTP port                                    | `3000`                    |
| `API_PREFIX`             | Global route prefix                          | `api`                     |
| `DATABASE_URL`           | PostgreSQL connection string                 | —                         |
| `JWT_ACCESS_SECRET`      | Secret for signing access tokens (≥16 chars) | —                         |
| `JWT_ACCESS_EXPIRES_IN`  | Access token lifetime                        | `15m`                     |
| `JWT_REFRESH_SECRET`     | Secret for signing refresh tokens (≥16 chars)| —                         |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime                       | `7d`                      |

---

## Running the application locally

```bash
# Development (watch mode)
pnpm start:dev

# Standard
pnpm start

# Production
pnpm build && pnpm start:prod
```

Once running:

- **API base URL:** `http://localhost:3000/api`
- **Swagger docs:** `http://localhost:3000/api/docs`
- **Health check:** `http://localhost:3000/api/health`

### Quick smoke test

```bash
# Register a user (returns an access + refresh token pair)
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"jane@example.com","password":"StrongPass123!"}'

# Call a protected route with the returned access token
curl http://localhost:3000/api/auth/me \
  -H 'Authorization: Bearer <ACCESS_TOKEN>'
```

---

## API Endpoints

All routes are mounted under the `API_PREFIX` (default `api`) and require a valid
bearer access token unless marked **Public**. Authorization is enforced by the
global `RolesGuard`; the **Roles** column lists who may call each route (any
authenticated user when blank).

### Auth (`/api/auth`)

| Method & Path             | Roles    | Description                              |
| ------------------------- | -------- | ---------------------------------------- |
| `POST /auth/register`     | Public   | Register a user, returns a token pair    |
| `POST /auth/login`        | Public   | Log in, returns an access + refresh pair |
| `POST /auth/refresh`      | Public   | Exchange a refresh token for a new pair  |
| `GET  /auth/me`           | —        | Current authenticated user's profile     |

### Users (`/api/users`)

| Method & Path        | Roles            | Description                |
| -------------------- | ---------------- | -------------------------- |
| `POST /users`        | `ADMIN`          | Create a user              |
| `GET  /users`        | `ADMIN`,`MANAGER`| List users (paginated)     |
| `GET  /users/:id`    | `ADMIN`,`MANAGER`| Get a user by id           |
| `PATCH /users/:id`   | `ADMIN`          | Update a user              |
| `DELETE /users/:id`  | `ADMIN`          | Delete a user (`204`)      |

### Customers (`/api/customers`)

Customers belong to the invoicing domain: any authenticated user may read them,
while mutations are restricted to `ADMIN` / `MANAGER` (deletes are `ADMIN`-only).

| Method & Path            | Roles             | Description                                              |
| ------------------------ | ----------------- | ------------------------------------------------------- |
| `POST /customers`        | `ADMIN`,`MANAGER` | Create a customer                                       |
| `GET  /customers`        | —                 | List customers (paginated; optional `?search=` on name/email/company) |
| `GET  /customers/:id`    | —                 | Get a customer by id (`404` when missing)               |
| `PATCH /customers/:id`   | `ADMIN`,`MANAGER` | Update a customer                                       |
| `DELETE /customers/:id`  | `ADMIN`           | Delete a customer (`204 No Content`)                    |

List endpoints accept `?page=` and `?limit=` (1–100) and return a
`{ data, meta: { page, limit, total, totalPages } }` payload inside the standard
`{ success, data }` envelope.

### Invoices (`/api/invoices`)

Invoices are the core of the ERP's billing domain. Any authenticated user may
read them; creation is restricted to `ADMIN` / `MANAGER`. This module is the
**foundation** — later features (add/update line items, status transitions, the
event history and dashboards) extend this same module and its schema.

| Method & Path                        | Roles             | Description                                                        |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------- |
| `POST   /invoices`                   | `ADMIN`,`MANAGER` | Create an invoice with optional inline line items                 |
| `GET    /invoices/:id`               | —                 | Get an invoice by id, including its items (`404` when missing)     |
| `POST   /invoices/:id/items`         | `ADMIN`,`MANAGER` | Add a line item; recomputes totals (`201`)                        |
| `PATCH  /invoices/:id/items/:itemId` | `ADMIN`,`MANAGER` | Update a line item; recomputes totals (`200`)                     |
| `DELETE /invoices/:id/items/:itemId` | `ADMIN`,`MANAGER` | Remove a line item; recomputes totals (`204 No Content`)          |

Behaviour and rules:

- **Auto invoice number.** Each invoice gets a unique `INV-<year>-<sequence>`
  number (e.g. `INV-2026-0001`), where the sequence resets per issue year and is
  zero-padded to four digits.
- **Money as `Decimal`, single currency.** `POST /invoices` accepts
  `customerId` (must reference an existing customer, else `404`), optional
  `dueDate`, `notes`, `taxRate` (percentage, `0–100`) and an optional inline
  `items[]` (`description`, positive `quantity`, positive `unitPrice`). The
  service derives every money field: `lineTotal = quantity × unitPrice`,
  `subtotal = Σ lineTotal`, `taxAmount = round(subtotal × taxRate ÷ 100, 2)` and
  `total = subtotal + taxAmount`.
- **Line-item mutations.** `POST/PATCH/DELETE /invoices/:id/items[/:itemId]`
  (`ADMIN`/`MANAGER`) add, update and remove line items. Items may only be
  mutated while the invoice is **editable** (status `DRAFT` or `SENT`); mutating
  a `PAID`/`VOID`/`OVERDUE` invoice returns `409 Conflict`. Each mutation runs in
  a transaction that re-derives `lineTotal` (`quantity × unitPrice`), recomputes
  `subtotal`/`taxAmount`/`total` via the shared totals helper, and appends the
  matching audit event. A missing invoice or item returns `404`.
- **Audit trail.** Creation and every mutation are written as append-only
  `InvoiceEvent` rows: `CREATED` on create and `ITEM_ADDED` / `ITEM_UPDATED` /
  `ITEM_REMOVED` on the respective line-item mutations, each stamped with the
  acting user.

**Schema.** `Invoice` (status `DRAFT`/`SENT`/`PAID`/`VOID`/`OVERDUE`, defaulting
to `DRAFT`) has many `InvoiceItem` and many `InvoiceEvent` rows (both cascade on
delete) and belongs to a `Customer`. Reusable helpers `computeInvoiceTotals`
(recompute totals) and `appendInvoiceEvent` (write an event within a
transaction) are exported from `invoices.service.ts` for the follow-up plans.

---

## Testing

Tests are a first-class part of this project — **every feature ships with tests**.

```bash
pnpm test         # unit tests
pnpm test:watch   # unit tests in watch mode
pnpm test:cov     # unit tests with coverage
pnpm test:e2e     # end-to-end tests (no real DB required — Prisma is stubbed)
```

---

## Project Structure

```
src/
├── common/                 # Cross-cutting building blocks (no feature logic)
│   ├── decorators/         # @Public, @Roles, @CurrentUser
│   ├── dto/                # Shared DTOs (pagination, paginated result)
│   ├── filters/            # Global exception filter (uniform error envelope)
│   ├── guards/             # JwtAuthGuard (authn), RolesGuard (authz)
│   ├── interceptors/       # Response transform ({ success, data })
│   └── types/              # Shared types (AuthenticatedUser)
├── config/                 # Typed configuration + Zod env validation
├── prisma/                 # PrismaModule + PrismaService (data-access layer)
├── modules/                # Feature modules (one folder per bounded context)
│   ├── auth/               # Registration, login, refresh, JWT strategy
│   ├── users/              # User CRUD, password hashing
│   ├── customers/          # Customer CRUD (invoicing domain)
│   ├── invoices/           # Invoice creation + retrieval (billing foundation)
│   └── health/             # Liveness/readiness probe
├── app.module.ts           # Composition root; wires global guards/filters
└── main.ts                 # Bootstrap: pipes, Swagger, security, shutdown hooks

prisma/
├── schema.prisma           # Data model (source of truth for the DB)
└── seed.ts                 # Idempotent seed script
```

---

## Architectural Decisions & Assumptions

- **Modular by feature (bounded contexts).** Each domain lives in its own module under `src/modules`, owning its controller, service, DTOs and entities. Modules talk to each other only through exported providers, never by reaching into another module's internals.

- **Strict service-layer separation.** Controllers are thin — they validate input and delegate to services. All business logic and persistence live in services. This keeps the HTTP layer swappable (REST today, a microservice transport tomorrow) and makes services trivially unit-testable.

- **Microservice-ready.** The data layer is hidden behind `PrismaService`, configuration is centralized and validated, and cross-cutting concerns are global providers. Any feature module can be lifted into its own deployable service by giving it its own `PrismaModule` and a transport (`@nestjs/microservices`) without rewriting business logic.

- **Stateless authentication.** JWT access + refresh tokens mean no server-side session store, so the API scales horizontally behind a load balancer. Access and refresh tokens are signed with **separate secrets**. The JWT strategy re-validates the user on every request, so deactivated accounts lose access immediately. _Assumption:_ refresh tokens are validated cryptographically rather than persisted; if token revocation lists are needed, add a store behind `AuthService`.

- **Authorization via a global RBAC guard.** `JwtAuthGuard` is applied globally (opt out per route with `@Public()`); `RolesGuard` enforces `@Roles(...)`. Roles live in the Prisma `Role` enum (`ADMIN`, `MANAGER`, `USER`).

- **Fail-fast configuration.** Environment variables are validated against a Zod schema at startup, so misconfiguration surfaces immediately instead of at the first request.

- **Uniform API contract.** A global interceptor wraps successes as `{ success: true, data }` and a global exception filter renders every error in a single predictable shape, so clients integrate against one consistent envelope.

- **Database as source of truth via Prisma migrations.** Schema changes are versioned in `prisma/migrations` and applied with `prisma migrate`, keeping environments reproducible. UUID primary keys are used to avoid leaking row counts and to ease future data federation across services.

---

## Available Scripts

| Script                | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `pnpm start:dev`      | Run in watch mode                            |
| `pnpm build`          | Compile to `dist/`                           |
| `pnpm start:prod`     | Run the compiled build                       |
| `pnpm test`           | Unit tests                                   |
| `pnpm test:e2e`       | End-to-end tests                             |
| `pnpm test:cov`       | Coverage report                             |
| `pnpm lint`           | Lint and auto-fix                            |
| `pnpm prisma:generate`| Generate the Prisma client                   |
| `pnpm prisma:migrate` | Create/apply a dev migration                 |
| `pnpm prisma:deploy`  | Apply migrations in production               |
| `pnpm prisma:studio`  | Open Prisma Studio (DB GUI)                  |
| `pnpm db:seed`        | Seed the database                            |

---

## Contributing Conventions

This repository follows a **test-driven, docs-current** workflow (see [`CLAUDE.md`](./CLAUDE.md)):

1. Every new or changed feature ships with unit tests (and e2e tests where it crosses the HTTP boundary).
2. The full test suite must pass before a change is considered done.
3. This README is kept in sync with the code whenever behaviour, scripts, or architecture change.
