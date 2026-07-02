import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { InvoiceStatus, Role } from '@prisma/client';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end tests for the Dashboard module. They exercise the real HTTP stack
 * (global JWT guard, RolesGuard, ValidationPipe, transform interceptor) with a
 * stubbed `PrismaService` so no database is required. They assert the summary
 * response shape for any authenticated user and the `401` for anonymous calls.
 */
describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let accessSecret: string;

  const regularUser = {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    email: 'user@test.local',
    role: Role.USER,
    isActive: true,
    password: 'x',
    firstName: null,
    lastName: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  const usersByEmail: Record<string, typeof regularUser> = {
    [regularUser.email]: regularUser,
  };

  const prismaStub = {
    user: {
      findUnique: jest.fn(
        ({ where: { email } }: { where: { email: string } }) =>
          Promise.resolve(usersByEmail[email] ?? null),
      ),
    },
    customer: { count: jest.fn() },
    invoice: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
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
    prismaStub.customer.count.mockReset();
    prismaStub.invoice.aggregate.mockReset();
    prismaStub.invoice.groupBy.mockReset();
    prismaStub.invoice.count.mockReset();
    prismaStub.invoice.findMany.mockReset();
  });

  const server = (): Server => app.getHttpServer() as Server;

  describe('authentication', () => {
    it('GET /api/dashboard/summary without a token → 401', () => {
      return request(server()).get('/api/dashboard/summary').expect(401);
    });
  });

  describe('summary', () => {
    it('any authenticated user gets the populated summary → 200', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.invoice.aggregate.mockImplementation(
        ({ where }: { where: { status: unknown } }) =>
          Promise.resolve({
            _sum: {
              total: where.status === InvoiceStatus.PAID ? 12500.5 : 3400,
            },
          }),
      );
      prismaStub.invoice.groupBy.mockResolvedValue([
        { status: InvoiceStatus.DRAFT, _count: { _all: 3 } },
        { status: InvoiceStatus.SENT, _count: { _all: 5 } },
        { status: InvoiceStatus.PAID, _count: { _all: 10 } },
      ]);
      prismaStub.invoice.count.mockResolvedValue(2);
      prismaStub.customer.count.mockResolvedValue(42);
      prismaStub.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-7',
          number: 'INV-2026-0007',
          total: 367.41,
          status: InvoiceStatus.SENT,
          issueDate: new Date('2026-07-01T00:00:00Z'),
          dueDate: new Date('2026-06-01T00:00:00Z'),
          customer: { name: 'Acme Corporation' },
        },
      ]);

      const res = await request(server())
        .get('/api/dashboard/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        success: boolean;
        data: {
          revenue: number;
          outstanding: number;
          invoiceCounts: Record<string, number>;
          customerCount: number;
          recentInvoices: Array<{
            id: string;
            number: string;
            customerName: string;
            total: number;
            status: string;
          }>;
        };
      };

      expect(body.success).toBe(true);
      expect(body.data.revenue).toBe(12500.5);
      expect(body.data.outstanding).toBe(3400);
      expect(body.data.customerCount).toBe(42);
      expect(body.data.invoiceCounts).toEqual({
        DRAFT: 3,
        SENT: 3,
        PAID: 10,
        VOID: 0,
        OVERDUE: 2,
      });
      expect(body.data.recentInvoices).toHaveLength(1);
      expect(body.data.recentInvoices[0]).toMatchObject({
        id: 'inv-7',
        number: 'INV-2026-0007',
        customerName: 'Acme Corporation',
        total: 367.41,
        status: InvoiceStatus.OVERDUE,
      });
    });

    it('returns zeroed aggregates on empty data → 200', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.invoice.aggregate.mockResolvedValue({ _sum: { total: null } });
      prismaStub.invoice.groupBy.mockResolvedValue([]);
      prismaStub.invoice.count.mockResolvedValue(0);
      prismaStub.customer.count.mockResolvedValue(0);
      prismaStub.invoice.findMany.mockResolvedValue([]);

      const res = await request(server())
        .get('/api/dashboard/summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        data: {
          revenue: number;
          outstanding: number;
          customerCount: number;
          invoiceCounts: Record<string, number>;
          recentInvoices: unknown[];
        };
      };
      expect(body.data.revenue).toBe(0);
      expect(body.data.outstanding).toBe(0);
      expect(body.data.customerCount).toBe(0);
      expect(body.data.invoiceCounts).toEqual({
        DRAFT: 0,
        SENT: 0,
        PAID: 0,
        VOID: 0,
        OVERDUE: 0,
      });
      expect(body.data.recentInvoices).toEqual([]);
    });
  });
});
