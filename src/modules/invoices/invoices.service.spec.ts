import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvoiceEventType, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoicesDto } from './dto/query-invoices.dto';
import {
  computeInvoiceTotals,
  deriveDisplayStatus,
  InvoicesService,
} from './invoices.service';

const customerId = '11111111-1111-1111-1111-111111111111';
const invoiceId = '33333333-3333-3333-3333-333333333333';
const actorId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Builds a persisted invoice model as Prisma would return it. */
const buildInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: invoiceId,
  number: 'INV-2026-0001',
  customerId,
  status: InvoiceStatus.DRAFT,
  issueDate: new Date('2026-07-01T00:00:00Z'),
  dueDate: null,
  notes: null,
  taxRate: new Prisma.Decimal(0),
  subtotal: new Prisma.Decimal(0),
  taxAmount: new Prisma.Decimal(0),
  total: new Prisma.Decimal(0),
  items: [],
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  ...overrides,
});

describe('InvoicesService', () => {
  let service: InvoicesService;
  let tx: {
    customer: { findUnique: jest.Mock };
    invoice: { count: jest.Mock; create: jest.Mock };
    invoiceEvent: { create: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    invoice: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    invoiceEvent: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: customerId }) },
      invoice: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      invoiceEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      invoice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      invoiceEvent: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(InvoicesService);
  });

  const dto = (
    overrides: Partial<CreateInvoiceDto> = {},
  ): CreateInvoiceDto => ({
    customerId,
    ...overrides,
  });

  describe('computeInvoiceTotals (recompute helper)', () => {
    it('derives line totals, subtotal, tax and total', () => {
      const totals = computeInvoiceTotals(
        [
          { quantity: 2, unitPrice: 150.5 },
          { quantity: 3, unitPrice: 10 },
        ],
        11,
      );
      expect(totals.lineTotals.map((d) => d.toNumber())).toEqual([301, 30]);
      expect(totals.subtotal.toNumber()).toBe(331);
      expect(totals.taxAmount.toNumber()).toBe(36.41); // 331 * 11% = 36.41
      expect(totals.total.toNumber()).toBe(367.41);
    });

    it('rounds tax half-up to 2 decimals', () => {
      const totals = computeInvoiceTotals(
        [{ quantity: 1, unitPrice: 333.33 }],
        15,
      );
      expect(totals.subtotal.toNumber()).toBe(333.33);
      expect(totals.taxAmount.toNumber()).toBe(50); // 49.9995 -> 50.00
      expect(totals.total.toNumber()).toBe(383.33);
    });

    it('is all-zero when there are no lines', () => {
      const totals = computeInvoiceTotals([], 20);
      expect(totals.subtotal.toNumber()).toBe(0);
      expect(totals.taxAmount.toNumber()).toBe(0);
      expect(totals.total.toNumber()).toBe(0);
    });
  });

  describe('create', () => {
    it('generates INV-<year>-0001 for the first invoice of the year', async () => {
      tx.invoice.count.mockResolvedValue(0);
      tx.invoice.create.mockImplementation(
        ({ data }: { data: { number: string } }) =>
          Promise.resolve(buildInvoice({ number: data.number })),
      );

      await service.create(dto());

      const year = new Date().getFullYear();
      const createCalls = tx.invoice.create.mock.calls as Array<
        [{ data: { number: string } }]
      >;
      expect(createCalls[0][0].data.number).toBe(`INV-${year}-0001`);
    });

    it('continues the yearly sequence from the existing count', async () => {
      tx.invoice.count.mockResolvedValue(41);
      tx.invoice.create.mockImplementation(
        ({ data }: { data: { number: string } }) =>
          Promise.resolve(buildInvoice({ number: data.number })),
      );

      await service.create(dto());

      const year = new Date().getFullYear();
      const createCalls = tx.invoice.create.mock.calls as Array<
        [{ data: { number: string } }]
      >;
      expect(createCalls[0][0].data.number).toBe(`INV-${year}-0042`);
    });

    it('creates an invoice with inline items and correct totals', async () => {
      tx.invoice.create.mockImplementation(
        ({
          data,
        }: {
          data: Record<string, unknown> & { items: { create: unknown[] } };
        }) =>
          Promise.resolve(buildInvoice({ ...data, items: data.items.create })),
      );

      const result = await service.create(
        dto({
          taxRate: 11,
          items: [
            { description: 'Consulting', quantity: 2, unitPrice: 150.5 },
            { description: 'Support', quantity: 3, unitPrice: 10 },
          ],
        }),
      );

      const createCalls = tx.invoice.create.mock.calls as Array<
        [
          {
            data: {
              subtotal: Prisma.Decimal;
              taxAmount: Prisma.Decimal;
              total: Prisma.Decimal;
              items: { create: Array<{ lineTotal: Prisma.Decimal }> };
            };
          },
        ]
      >;
      const createArg = createCalls[0][0];
      expect(Number(createArg.data.subtotal)).toBe(331);
      expect(Number(createArg.data.taxAmount)).toBe(36.41);
      expect(Number(createArg.data.total)).toBe(367.41);
      expect(
        createArg.data.items.create.map((i) => Number(i.lineTotal)),
      ).toEqual([301, 30]);
      expect(result.total).toBe(367.41);
      expect(result.customerId).toBe(customerId);
    });

    it('creates a zero-total invoice when no items are supplied', async () => {
      tx.invoice.create.mockImplementation(
        ({
          data,
        }: {
          data: Record<string, unknown> & { items: { create: unknown[] } };
        }) =>
          Promise.resolve(buildInvoice({ ...data, items: data.items.create })),
      );

      const result = await service.create(dto());

      const createCalls = tx.invoice.create.mock.calls as Array<
        [{ data: { items: { create: unknown[] } } }]
      >;
      expect(createCalls[0][0].data.items.create).toHaveLength(0);
      expect(result.subtotal).toBe(0);
      expect(result.total).toBe(0);
    });

    it('writes a CREATED audit event with the actor', async () => {
      tx.invoice.create.mockResolvedValue(buildInvoice());

      await service.create(dto(), actorId);

      expect(tx.invoiceEvent.create).toHaveBeenCalledTimes(1);
      const eventCalls = tx.invoiceEvent.create.mock.calls as Array<
        [{ data: { type: string; toStatus: string; actorUserId: string } }]
      >;
      const eventArg = eventCalls[0][0];
      expect(eventArg.data.type).toBe(InvoiceEventType.CREATED);
      expect(eventArg.data.toStatus).toBe(InvoiceStatus.DRAFT);
      expect(eventArg.data.actorUserId).toBe(actorId);
    });

    it('throws NotFound when the customer does not exist', async () => {
      tx.customer.findUnique.mockResolvedValue(null);

      await expect(service.create(dto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.invoice.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the invoice with its items when found', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          items: [
            {
              id: 'item-1',
              invoiceId,
              description: 'Consulting',
              quantity: new Prisma.Decimal(2),
              unitPrice: new Prisma.Decimal(150.5),
              lineTotal: new Prisma.Decimal(301),
              createdAt: new Date('2026-07-01T00:00:00Z'),
              updatedAt: new Date('2026-07-01T00:00:00Z'),
            },
          ],
        }),
      );

      const result = await service.findById(invoiceId);

      expect(result.id).toBe(invoiceId);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].lineTotal).toBe(301);
      expect(prisma.invoice.findUnique).toHaveBeenCalledWith({
        where: { id: invoiceId },
        include: { items: true },
      });
    });

    it('throws NotFound when the invoice is missing', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('deriveDisplayStatus', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const past = new Date('2026-06-01T00:00:00Z');
    const future = new Date('2026-08-01T00:00:00Z');

    it('shows OVERDUE for a SENT invoice past its due date', () => {
      expect(
        deriveDisplayStatus({ status: InvoiceStatus.SENT, dueDate: past }, now),
      ).toBe(InvoiceStatus.OVERDUE);
    });

    it('keeps SENT when the due date is still in the future', () => {
      expect(
        deriveDisplayStatus(
          { status: InvoiceStatus.SENT, dueDate: future },
          now,
        ),
      ).toBe(InvoiceStatus.SENT);
    });

    it('keeps SENT when there is no due date', () => {
      expect(
        deriveDisplayStatus({ status: InvoiceStatus.SENT, dueDate: null }, now),
      ).toBe(InvoiceStatus.SENT);
    });

    it('never overrides DRAFT, PAID or VOID even when past due', () => {
      for (const status of [
        InvoiceStatus.DRAFT,
        InvoiceStatus.PAID,
        InvoiceStatus.VOID,
      ]) {
        expect(deriveDisplayStatus({ status, dueDate: past }, now)).toBe(
          status,
        );
      }
    });
  });

  describe('findAll', () => {
    const buildQuery = (overrides: Partial<QueryInvoicesDto> = {}) =>
      Object.assign(new QueryInvoicesDto(), {
        page: 1,
        limit: 20,
        ...overrides,
      });

    const buildRow = (overrides: Record<string, unknown> = {}) => ({
      ...buildInvoice(),
      customer: { id: customerId, name: 'Acme Corp' },
      ...overrides,
    });

    it('returns a paginated result with customer and total, ordered by issueDate desc', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        buildRow({ total: new Prisma.Decimal(367.41) }),
      ]);
      prisma.invoice.count.mockResolvedValue(1);

      const result = await service.findAll(buildQuery());

      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(result.data[0].customer).toEqual({
        id: customerId,
        name: 'Acme Corp',
      });
      expect(result.data[0].total).toBe(367.41);
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 20,
          orderBy: { issueDate: 'desc' },
          include: { customer: { select: { id: true, name: true } } },
        }),
      );
      expect(prisma.invoice.count).toHaveBeenCalledWith({ where: {} });
    });

    it('surfaces the derived OVERDUE display status without changing the stored status', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        buildRow({
          status: InvoiceStatus.SENT,
          dueDate: new Date('2000-01-01T00:00:00Z'),
        }),
      ]);
      prisma.invoice.count.mockResolvedValue(1);

      const result = await service.findAll(buildQuery());

      expect(result.data[0].status).toBe(InvoiceStatus.SENT);
      expect(result.data[0].displayStatus).toBe(InvoiceStatus.OVERDUE);
    });

    it('filters by status', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await service.findAll(buildQuery({ status: InvoiceStatus.PAID }));

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: InvoiceStatus.PAID } }),
      );
      expect(prisma.invoice.count).toHaveBeenCalledWith({
        where: { status: InvoiceStatus.PAID },
      });
    });

    it('filters by customerId', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await service.findAll(buildQuery({ customerId }));

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { customerId } }),
      );
    });

    it('filters by invoice number search (case-insensitive)', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await service.findAll(buildQuery({ search: 'INV-2026' }));

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { number: { contains: 'INV-2026', mode: 'insensitive' } },
        }),
      );
    });

    it('filters by the issued date range', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(0);

      await service.findAll(
        buildQuery({
          issuedFrom: '2026-01-01T00:00:00.000Z',
          issuedTo: '2026-12-31T23:59:59.999Z',
        }),
      );

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            issueDate: {
              gte: new Date('2026-01-01T00:00:00.000Z'),
              lte: new Date('2026-12-31T23:59:59.999Z'),
            },
          },
        }),
      );
    });

    it('honours pagination (skip/take) from the query', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);
      prisma.invoice.count.mockResolvedValue(45);

      const result = await service.findAll(buildQuery({ page: 3, limit: 10 }));

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.meta.total).toBe(45);
      expect(result.meta.totalPages).toBe(5);
    });
  });

  describe('findEvents', () => {
    const buildEvent = (overrides: Record<string, unknown> = {}) => ({
      id: 'event-1',
      invoiceId,
      type: InvoiceEventType.CREATED,
      fromStatus: null,
      toStatus: InvoiceStatus.DRAFT,
      message: 'Invoice INV-2026-0001 created',
      actorUserId: null,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      ...overrides,
    });

    it('returns the invoice events ordered by createdAt asc', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ id: invoiceId });
      prisma.invoiceEvent.findMany.mockResolvedValue([
        buildEvent(),
        buildEvent({
          id: 'event-2',
          type: InvoiceEventType.STATUS_CHANGED,
          actorUserId: null,
          createdAt: new Date('2026-07-02T00:00:00Z'),
        }),
      ]);

      const result = await service.findEvents(invoiceId);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('event-1');
      expect(result[1].id).toBe('event-2');
      expect(prisma.invoiceEvent.findMany).toHaveBeenCalledWith({
        where: { invoiceId },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('resolves the actor email for events that have an actor', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ id: invoiceId });
      prisma.invoiceEvent.findMany.mockResolvedValue([
        buildEvent({ actorUserId: actorId }),
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: actorId, email: 'admin@test.local' },
      ]);

      const result = await service.findEvents(invoiceId);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: [actorId] } },
        select: { id: true, email: true },
      });
      expect(result[0].actorEmail).toBe('admin@test.local');
    });

    it('leaves actorEmail null for system events and skips the user lookup', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ id: invoiceId });
      prisma.invoiceEvent.findMany.mockResolvedValue([buildEvent()]);

      const result = await service.findEvents(invoiceId);

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(result[0].actorEmail).toBeNull();
    });

    it('throws NotFound when the invoice does not exist', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);

      await expect(service.findEvents('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.invoiceEvent.findMany).not.toHaveBeenCalled();
    });
  });
});
