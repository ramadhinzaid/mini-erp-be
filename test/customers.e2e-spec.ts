import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end tests for the Customers module. They exercise the real HTTP stack
 * (global JWT guard, RolesGuard, ValidationPipe, transform interceptor) with a
 * stubbed `PrismaService` so no database is required. The JWT strategy looks up
 * the user via `prisma.user.findUnique`, so the stub returns matching accounts
 * for the tokens we mint.
 */
describe('Customers (e2e)', () => {
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

  const customerId = '22222222-2222-2222-2222-222222222222';
  const buildCustomer = (overrides: Record<string, unknown> = {}) => ({
    id: customerId,
    name: 'Acme Corporation',
    email: 'contact@acme.example',
    phone: '+1-202-555-0142',
    company: 'Acme Corporation',
    address: '123 Market St',
    notes: null,
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  });

  const prismaStub = {
    user: {
      findUnique: jest.fn(
        ({ where: { email } }: { where: { email: string } }) =>
          Promise.resolve(usersByEmail[email] ?? null),
      ),
    },
    customer: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
    prismaStub.customer.create.mockReset();
    prismaStub.customer.findMany.mockReset();
    prismaStub.customer.count.mockReset();
    prismaStub.customer.findUnique.mockReset();
    prismaStub.customer.update.mockReset();
    prismaStub.customer.delete.mockReset();
  });

  const server = (): Server => app.getHttpServer() as Server;

  describe('authentication', () => {
    it('GET /api/customers without a token → 401', () => {
      return request(server()).get('/api/customers').expect(401);
    });

    it('POST /api/customers without a token → 401', () => {
      return request(server())
        .post('/api/customers')
        .send({ name: 'Nope' })
        .expect(401);
    });
  });

  describe('RBAC enforcement', () => {
    it('USER creating a customer → 403', async () => {
      const token = await tokenFor(regularUser);
      await request(server())
        .post('/api/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme' })
        .expect(403);
      expect(prismaStub.customer.create).not.toHaveBeenCalled();
    });

    it('USER deleting a customer → 403', async () => {
      const token = await tokenFor(regularUser);
      await request(server())
        .delete(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(prismaStub.customer.delete).not.toHaveBeenCalled();
    });

    it('MANAGER deleting a customer → 403 (delete is admin-only)', async () => {
      const token = await tokenFor(manager);
      await request(server())
        .delete(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });
  });

  describe('CRUD', () => {
    it('ADMIN creates a customer → 201 wrapped envelope', async () => {
      const token = await tokenFor(admin);
      prismaStub.customer.create.mockResolvedValue(buildCustomer());

      const res = await request(server())
        .post('/api/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corporation', email: 'contact@acme.example' })
        .expect(201);

      const body = res.body as {
        success: boolean;
        data: { id: string; name: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(customerId);
      expect(body.data.name).toBe('Acme Corporation');
      expect(prismaStub.customer.create).toHaveBeenCalledTimes(1);
    });

    it('MANAGER creates a customer → 201', async () => {
      const token = await tokenFor(manager);
      prismaStub.customer.create.mockResolvedValue(buildCustomer());

      await request(server())
        .post('/api/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Corporation' })
        .expect(201);
    });

    it('rejects an invalid create body → 400', async () => {
      const token = await tokenFor(admin);
      await request(server())
        .post('/api/customers')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'not-an-email' })
        .expect(400);
    });

    it('any authenticated USER lists customers (paginated + search) → 200', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.customer.findMany.mockResolvedValue([buildCustomer()]);
      prismaStub.customer.count.mockResolvedValue(1);

      const res = await request(server())
        .get('/api/customers?search=acme&page=1&limit=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        data: { data: unknown[]; meta: { total: number; limit: number } };
      };
      expect(body.data.data).toHaveLength(1);
      expect(body.data.meta.total).toBe(1);
      expect(body.data.meta.limit).toBe(10);

      const findManyCalls = prismaStub.customer.findMany.mock.calls as Array<
        [{ where: { OR: unknown[] }; skip: number; take: number }]
      >;
      const callArg = findManyCalls[0][0];
      expect(callArg.where.OR).toHaveLength(3);
      expect(callArg.take).toBe(10);
    });

    it('USER fetches a customer by id → 200', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.customer.findUnique.mockResolvedValue(buildCustomer());

      const res = await request(server())
        .get(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { data: { id: string } };
      expect(body.data.id).toBe(customerId);
    });

    it('returns 404 for a missing customer', async () => {
      const token = await tokenFor(regularUser);
      prismaStub.customer.findUnique.mockResolvedValue(null);

      await request(server())
        .get(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects a non-UUID id → 400', async () => {
      const token = await tokenFor(regularUser);
      await request(server())
        .get('/api/customers/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('MANAGER updates a customer → 200', async () => {
      const token = await tokenFor(manager);
      prismaStub.customer.findUnique.mockResolvedValue(buildCustomer());
      prismaStub.customer.update.mockResolvedValue(
        buildCustomer({ name: 'Acme Inc.' }),
      );

      const res = await request(server())
        .patch(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Inc.' })
        .expect(200);

      const body = res.body as { data: { name: string } };
      expect(body.data.name).toBe('Acme Inc.');
    });

    it('ADMIN deletes a customer → 204 No Content', async () => {
      const token = await tokenFor(admin);
      prismaStub.customer.findUnique.mockResolvedValue(buildCustomer());
      prismaStub.customer.delete.mockResolvedValue(buildCustomer());

      await request(server())
        .delete(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      expect(prismaStub.customer.delete).toHaveBeenCalledTimes(1);
    });
  });
});
