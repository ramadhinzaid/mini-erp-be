import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end coverage for the login flow and an authenticated round-trip to
 * `GET /api/auth/me` using a token issued by `POST /api/auth/login`.
 *
 * `PrismaService` is stubbed (per the README, the e2e suite runs without a real
 * database) with a `user.findUnique` that resolves the seeded fixtures by email
 * or id — the two lookups the auth flow performs.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;

  const PLAIN_PASSWORD = 'StrongPass123!';

  // Populated in beforeAll once the password hash has been computed.
  let activeUser: {
    id: string;
    email: string;
    password: string;
    firstName: string | null;
    lastName: string | null;
    role: Role;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  let inactiveUser: typeof activeUser;

  const prismaStub = {
    $runCommandRaw: jest
      .fn()
      .mockRejectedValue(new Error('Use the mongodb provider')),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ result: 1 }]),
    user: {
      findUnique: jest.fn(
        ({ where }: { where: { email?: string; id?: string } }) => {
          const candidates = [activeUser, inactiveUser];
          const match = candidates.find(
            (u) =>
              (where.email !== undefined && u.email === where.email) ||
              (where.id !== undefined && u.id === where.id),
          );
          return Promise.resolve(match ?? null);
        },
      ),
    },
  };

  beforeAll(async () => {
    // Satisfy the env-validation schema before the module is compiled.
    process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-value';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-value';

    const passwordHash = await bcrypt.hash(PLAIN_PASSWORD, 10);
    activeUser = {
      id: 'active-user-1',
      email: 'active@example.com',
      password: passwordHash,
      firstName: 'Active',
      lastName: 'User',
      role: Role.USER,
      isActive: true,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    };
    inactiveUser = {
      ...activeUser,
      id: 'inactive-user-1',
      email: 'inactive@example.com',
      isActive: false,
    };

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

  const server = (): Server => app.getHttpServer() as Server;

  const login = (email: string, password: string) =>
    request(server()).post('/api/auth/login').send({ email, password });

  it('POST /api/auth/login → 200 with an access + refresh token pair', async () => {
    const response = await login(activeUser.email, PLAIN_PASSWORD);

    expect(response.status).toBe(200);
    const body = response.body as {
      data: { accessToken: string; refreshToken: string; tokenType: string };
    };
    expect(typeof body.data.accessToken).toBe('string');
    expect(body.data.accessToken.length).toBeGreaterThan(0);
    expect(typeof body.data.refreshToken).toBe('string');
    expect(body.data.refreshToken.length).toBeGreaterThan(0);
    expect(body.data.tokenType).toBe('Bearer');
    // The password hash must never leak into the response.
    expect(JSON.stringify(response.body)).not.toContain(activeUser.password);
  });

  it('POST /api/auth/login with a wrong password → 401', async () => {
    const response = await login(activeUser.email, 'wrong-password');

    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain(activeUser.password);
  });

  it('POST /api/auth/login with an unknown email → 401', async () => {
    const response = await login('nobody@example.com', PLAIN_PASSWORD);

    expect(response.status).toBe(401);
  });

  it('POST /api/auth/login for an inactive account → 401', async () => {
    const response = await login(inactiveUser.email, PLAIN_PASSWORD);

    expect(response.status).toBe(401);
  });

  it('GET /api/auth/me round-trips with a token issued by login', async () => {
    const loginResponse = await login(activeUser.email, PLAIN_PASSWORD);
    expect(loginResponse.status).toBe(200);
    const { accessToken } = (
      loginResponse.body as { data: { accessToken: string } }
    ).data;

    const meResponse = await request(server())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(meResponse.status).toBe(200);
    const me = (meResponse.body as { data: Record<string, unknown> }).data;
    expect(me.id).toBe(activeUser.id);
    expect(me.email).toBe(activeUser.email);
    expect(me.role).toBe(activeUser.role);
    // The profile payload must never expose the password hash.
    expect(me.password).toBeUndefined();
  });
});
