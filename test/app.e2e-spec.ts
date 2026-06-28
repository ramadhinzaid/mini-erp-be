import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end tests that exercise the HTTP layer (global guards, pipes, prefix)
 * without a real database. `PrismaService` is replaced with a lightweight stub
 * so the suite runs anywhere — CI included — with no external dependencies.
 */
describe('App (e2e)', () => {
  let app: INestApplication;

  // Mirrors how terminus probes a Postgres client: $runCommandRaw rejects with
  // the mongodb-provider hint, and the indicator falls back to $queryRawUnsafe.
  const prismaStub = {
    $runCommandRaw: jest
      .fn()
      .mockRejectedValue(new Error('Use the mongodb provider')),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ result: 1 }]),
  };

  beforeAll(async () => {
    // Satisfy the env-validation schema before the module is compiled.
    process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
    process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-value';
    process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-value';

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

  it('GET /api/health → 200 and reports the database as up', async () => {
    const response = await request(server()).get('/api/health');
    expect(response.status).toBe(200);
    const body = response.body as { data: { status: string } };
    expect(body.data.status).toBe('ok');
  });

  it('GET /api/auth/me without a token → 401', () => {
    return request(server()).get('/api/auth/me').expect(401);
  });

  it('POST /api/auth/login with an invalid body → 400', () => {
    return request(server())
      .post('/api/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400);
  });
});
