import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, Role } from '@prisma/client';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end tests for the Invoices module. They exercise the real HTTP stack
 * (global JWT guard, RolesGuard, ValidationPipe, transform interceptor) with a
 * stubbed `PrismaService` so no database is required. `$transaction` invokes its
 * callback with the same stub, so service transactions run against these mocks.
 */
describe('Invoices (e2e)', () => {
  let app: INestApplication;
  let accessSecret: string;

  const admin = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'admin@test.local',
    role: Role.ADMIN,
    isActive: true,
    password: 'x',
    firstName: null,
    lastName: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
  const manager = {
    ...admin,
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    email: 'manager@test.local',
    role: Role.MANAGER,
  };
  const regularUser = {
    ...admin,
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    email: 'user@test.local',
    role: Role.USER,
  };

  const usersByEmail: Record<string, typeof admin> = {
    [admin.email]: admin,
    [manager.email]: manager,
    [regularUser.email]: regularUser,
  };

  const customerId = '22222222-2222-4222-8222-222222222222';
  const invoiceId = '33333333-3333-4333-8333-333333333333';

  const buildInvoice = (overrides: Record<string, unknown> = {}) => ({
    id: invoiceId,
    number: 'INV-2026-0001',
    customerId,
    status: InvoiceStatus.DRAFT,
    issueDate: new Date('2026-07-01T00:00:00Z'),
    dueDate: null,
    notes: null,
    taxRate: 11,
    subtotal: 331,
    taxAmount: 36.41,
    total: 367.41,
    items: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        invoiceId,
        description: 'Consulting',
        quantity: 2,
        unitPrice: 150.5,
        lineTotal: 301,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        invoiceId,
        description: 'Support',
        quantity: 3,
        unitPrice: 10,
        lineTotal: 30,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      },
    ],
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  });

  const prismaStub = {
    user: {
      findUnique: jest.fn(
        ({ where: { email } }: { where: { email: string } }) =>
          Promise.resolve(usersByEmail[email] ?? null),
      ),
    },
    customer: { findUnique: jest.fn() },
    invoice: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    invoiceEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const tokenFor = async (user: { id: string; email: string; role: Role }) => {
    const jwt = app.get(JwtService);
    return jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { secret: accessSecret, expiresIn: '15m' },
    );
  };

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-value';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-value';
    accessSecret = process.env.JWT_ACCESS_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaStub.customer.findUnique.mockReset();
    prismaStub.invoice.count.mockReset();
    prismaStub.invoice.create.mockReset();
    prismaStub.invoice.findUnique.mockReset();
    prismaStub.invoice.update.mockReset();
    prismaStub.invoiceEvent.create.mockReset();
    // Run service transactions against the same stub.
    prismaStub.$transaction.mockImplementation(
      (cb: (client: typeof prismaStub) => unknown) => cb(prismaStub),
    );
  });

  const server = (): Server => app.getHttpServer() as Server;

  describe('authentication', () => {
    it('POST /api/invoices without a token → 401', () => {
      return request(server())
        .post('/api/invoices')
        .send({ customerId })
        .expect(401);
    });

    it('GET /api/invoices/:id without a token → 401', () => {
      return request(server()).get(`/api/invoices/${invoiceId}`).expect(401);
    });
  });

  describe('RBAC enforcement', () => {
    it('USER creating an invoice → 403', async () => {
      const token = await tokenFor(regularUser);
      await request(server())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerId })
        .expect(403);
      expect(prismaStub.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('ADMIN creates an invoice with inline items → 201 with totals', async () => {
      const token = await tokenFor(admin);
      prismaStub.customer.findUnique.mockResolvedValue({ id: customerId });
      prismaStub.invoice.count.mockResolvedValue(0);
      prismaStub.invoice.create.mockResolvedValue(buildInvoice());
      prismaStub.invoiceEvent.create.mockResolvedValue({});

      const res = await request(server())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId,
          taxRate: 11,
          items: [
            { description: 'Consulting', quantity: 2, unitPrice: 150.5 },
            { description: 'Support', quantity: 3, unitPrice: 10 },
          ],
        })
        .expect(201);

      const body = res.body as {
        success: boolean;
        data: {
          number: string;
          subtotal: number;
          taxAmount: number;
          total: number;
          items: unknown[];
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.number).toMatch(/^INV-\d{4}-\d{4}$/);
      expect(body.data.subtotal).toBe(331);
      expect(body.data.taxAmount).toBe(36.41);
      expect(body.data.total).toBe(367.41);
      expect(body.data.items).toHaveLength(2);
      expect(prismaStub.invoiceEvent.create).toHaveBeenCalledTimes(1);
    });

    it('MANAGER creates an invoice → 201', async () => {
      const token = await tokenFor(manager);
      prismaStub.customer.findUnique.mockResolvedValue({ id: customerId });
      prismaStub.invoice.count.mockResolvedValue(0);
      prismaStub.invoice.create.mockResolvedValue(buildInvoice({ items: [] }));
      prismaStub.invoiceEvent.create.mockResolvedValue({});

      await request(server())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerId })
        .expect(201);
    });

    it('returns 404 when the customer does not exist', async () => {
      const token = await tokenFor(admin);
      prismaStub.customer.findUnique.mockResolvedValue(null);

      await request(server())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerId })
        .expect(404);
      expect(prismaStub.invoice.create).not.toHaveBeenCalled();
    });

    it('rejects a body with a non-UUID customerId → 400', async () => {
      const token = await tokenFor(admin);
      await request(server())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({ customerId: 'not-a-uuid' })
        .expect(400);
    });

    it('rejects an item with a non-positive quantity → 400', async () => {
      const token = await tokenFor(admin);
      await request(server())
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId,
          items: [{ description: 'Bad', quantity: 0, unitPrice: 10 }],
        })
        .expect(400);
    });
  });

  describe('findOne', () => {
    it('any authenticated USER fetches an invoice by id → 200 with items', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.invoice.findUnique.mockResolvedValue(buildInvoice());

      const res = await request(server())
        .get(`/api/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { data: { id: string; items: unknown[] } };
      expect(body.data.id).toBe(invoiceId);
      expect(body.data.items).toHaveLength(2);
    });

    it('returns 404 for a missing invoice', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.invoice.findUnique.mockResolvedValue(null);

      await request(server())
        .get(`/api/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects a non-UUID id → 400', async () => {
      const token = await tokenFor(regularUser);
      await request(server())
        .get('/api/invoices/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('updateStatus (PATCH /:id/status)', () => {
    /** Stubs an existing invoice in `status` and echoes updates back. */
    const arrange = (status: InvoiceStatus, overrides = {}) => {
      prismaStub.invoice.findUnique.mockResolvedValue(
        buildInvoice({ status, ...overrides }),
      );
      prismaStub.invoice.update.mockImplementation(
        ({ data }: { data: { status: InvoiceStatus } }) =>
          Promise.resolve(buildInvoice({ status: data.status, ...overrides })),
      );
      prismaStub.invoiceEvent.create.mockResolvedValue({});
    };

    it('PATCH without a token → 401', () => {
      return request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .send({ status: InvoiceStatus.SENT })
        .expect(401);
    });

    it('ADMIN transitions DRAFT → SENT → 200 and logs the event', async () => {
      const token = await tokenFor(admin);
      arrange(InvoiceStatus.DRAFT);

      const res = await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.SENT })
        .expect(200);

      const body = res.body as {
        data: { status: string; displayStatus: string };
      };
      expect(body.data.status).toBe(InvoiceStatus.SENT);
      expect(prismaStub.invoiceEvent.create).toHaveBeenCalledTimes(1);
    });

    it('MANAGER transitions SENT → PAID → 200', async () => {
      const token = await tokenFor(manager);
      arrange(InvoiceStatus.SENT);

      const res = await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.PAID })
        .expect(200);

      expect((res.body as { data: { status: string } }).data.status).toBe(
        InvoiceStatus.PAID,
      );
    });

    it('surfaces derived OVERDUE as displayStatus on a past-due SENT invoice', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          status: InvoiceStatus.SENT,
          dueDate: new Date('2000-01-01T00:00:00Z'),
        }),
      );

      const res = await request(server())
        .get(`/api/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        data: { status: string; displayStatus: string };
      };
      expect(body.data.status).toBe(InvoiceStatus.SENT);
      expect(body.data.displayStatus).toBe(InvoiceStatus.OVERDUE);
    });

    it('illegal transition PAID → SENT → 409', async () => {
      const token = await tokenFor(admin);
      arrange(InvoiceStatus.PAID);

      await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.SENT })
        .expect(409);
      expect(prismaStub.invoice.update).not.toHaveBeenCalled();
    });

    it('client-supplied OVERDUE → 400', async () => {
      const token = await tokenFor(admin);
      arrange(InvoiceStatus.SENT);

      await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.OVERDUE })
        .expect(400);
      expect(prismaStub.invoice.update).not.toHaveBeenCalled();
    });

    it('unknown status value → 400', async () => {
      const token = await tokenFor(admin);
      await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'ARCHIVED' })
        .expect(400);
    });

    it('USER attempting a status change → 403', async () => {
      const token = await tokenFor(regularUser);
      await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.SENT })
        .expect(403);
      expect(prismaStub.invoice.update).not.toHaveBeenCalled();
    });

    it('non-admin (MANAGER) voiding an invoice → 403', async () => {
      const token = await tokenFor(manager);
      arrange(InvoiceStatus.SENT);

      await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.VOID })
        .expect(403);
      expect(prismaStub.invoice.update).not.toHaveBeenCalled();
    });

    it('ADMIN voiding a DRAFT invoice → 200', async () => {
      const token = await tokenFor(admin);
      arrange(InvoiceStatus.DRAFT);

      const res = await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.VOID })
        .expect(200);

      expect((res.body as { data: { status: string } }).data.status).toBe(
        InvoiceStatus.VOID,
      );
    });

    it('404 when the invoice does not exist', async () => {
      const token = await tokenFor(admin);
      prismaStub.invoice.findUnique.mockResolvedValue(null);

      await request(server())
        .patch(`/api/invoices/${invoiceId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: InvoiceStatus.SENT })
        .expect(404);
    });
  });
});
