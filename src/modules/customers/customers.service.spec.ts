import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Customer } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CustomersService } from './customers.service';
import { QueryCustomersDto } from './dto/query-customers.dto';

const buildCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: '22222222-2222-2222-2222-222222222222',
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

const buildQuery = (overrides: Partial<QueryCustomersDto> = {}) =>
  Object.assign(new QueryCustomersDto(), { page: 1, limit: 20, ...overrides });

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: {
    customer: {
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
      customer: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(CustomersService);
  });

  describe('create', () => {
    it('persists the customer and returns the entity', async () => {
      const created = buildCustomer();
      prisma.customer.create.mockResolvedValue(created);

      const result = await service.create({
        name: created.name,
        email: created.email ?? undefined,
      });

      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: { name: created.name, email: created.email },
      });
      expect(result.id).toBe(created.id);
      expect(result.name).toBe(created.name);
    });
  });

  describe('findAll', () => {
    it('returns a paginated result with correct metadata and no filter', async () => {
      prisma.customer.findMany.mockResolvedValue([buildCustomer()]);
      prisma.customer.count.mockResolvedValue(1);

      const result = await service.findAll(buildQuery());

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20, where: undefined }),
      );
      expect(prisma.customer.count).toHaveBeenCalledWith({ where: undefined });
    });

    it('applies an OR search filter on name/email/company when search is set', async () => {
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.count.mockResolvedValue(0);

      await service.findAll(buildQuery({ search: 'acme', page: 2, limit: 10 }));

      const expectedWhere = {
        OR: [
          { name: { contains: 'acme', mode: 'insensitive' } },
          { email: { contains: 'acme', mode: 'insensitive' } },
          { company: { contains: 'acme', mode: 'insensitive' } },
        ],
      };
      expect(prisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10, where: expectedWhere }),
      );
      expect(prisma.customer.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('computes totalPages from the total count', async () => {
      prisma.customer.findMany.mockResolvedValue([buildCustomer()]);
      prisma.customer.count.mockResolvedValue(45);

      const result = await service.findAll(buildQuery({ limit: 20 }));

      expect(result.meta.total).toBe(45);
      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('findById', () => {
    it('returns the entity when the customer exists', async () => {
      const customer = buildCustomer();
      prisma.customer.findUnique.mockResolvedValue(customer);

      const result = await service.findById(customer.id);

      expect(result.id).toBe(customer.id);
      expect(prisma.customer.findUnique).toHaveBeenCalledWith({
        where: { id: customer.id },
      });
    });

    it('throws NotFoundException when the customer is missing', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates an existing customer and returns the entity', async () => {
      const existing = buildCustomer();
      const updated = buildCustomer({ name: 'Acme Inc.' });
      prisma.customer.findUnique.mockResolvedValue(existing);
      prisma.customer.update.mockResolvedValue(updated);

      const result = await service.update(existing.id, { name: 'Acme Inc.' });

      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: existing.id },
        data: { name: 'Acme Inc.' },
      });
      expect(result.name).toBe('Acme Inc.');
    });

    it('throws NotFoundException when updating a missing customer', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { name: 'Nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an existing customer', async () => {
      const customer = buildCustomer();
      prisma.customer.findUnique.mockResolvedValue(customer);
      prisma.customer.delete.mockResolvedValue(customer);

      await service.remove(customer.id);

      expect(prisma.customer.delete).toHaveBeenCalledWith({
        where: { id: customer.id },
      });
    });

    it('throws NotFoundException when removing a missing customer', async () => {
      prisma.customer.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.customer.delete).not.toHaveBeenCalled();
    });
  });
});
