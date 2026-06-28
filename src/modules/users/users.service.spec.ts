import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from './users.service';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: '11111111-1111-1111-1111-111111111111',
  email: 'jane@example.com',
  password: 'hashed',
  firstName: 'Jane',
  lastName: 'Doe',
  role: Role.USER,
  isActive: true,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('hashes the password and never returns it', async () => {
      const created = buildUser();
      prisma.user.create.mockResolvedValue(created);

      const result = await service.create({
        email: created.email,
        password: 'PlainPass123!',
      });

      // Password is hashed before persisting.
      const createCalls = prisma.user.create.mock.calls as Array<
        [{ data: { password: string } }]
      >;
      const persistedPassword = createCalls[0][0].data.password;
      expect(persistedPassword).not.toBe('PlainPass123!');
      await expect(
        bcrypt.compare('PlainPass123!', persistedPassword),
      ).resolves.toBe(true);

      // Returned entity excludes the hash entirely.
      expect(result).not.toHaveProperty('password');
      expect(result.email).toBe(created.email);
    });

    it('maps unique-constraint violations to ConflictException', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(
        service.create({ email: 'dup@example.com', password: 'PlainPass123!' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns a paginated result with correct metadata', async () => {
      prisma.user.findMany.mockResolvedValue([buildUser()]);
      prisma.user.count.mockResolvedValue(1);

      const query = Object.assign(new PaginationQueryDto(), {
        page: 1,
        limit: 20,
      });
      const result = await service.findAll(query);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when the user is missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes an existing user', async () => {
      const user = buildUser();
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.delete.mockResolvedValue(user);

      await service.remove(user.id);

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: user.id },
      });
    });
  });
});
