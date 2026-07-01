import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvoiceEventType, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { computeInvoiceTotals, InvoicesService } from './invoices.service';

const customerId = '11111111-1111-1111-1111-111111111111';
const invoiceId = '33333333-3333-3333-3333-333333333333';
const actorId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Builds a persisted invoice line item as Prisma would return it. */
const buildItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  invoiceId,
  description: 'Consulting',
  quantity: new Prisma.Decimal(2),
  unitPrice: new Prisma.Decimal(150.5),
  lineTotal: new Prisma.Decimal(301),
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  ...overrides,
});

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
    invoice: {
      count: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    invoiceItem: {
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findMany: jest.Mock;
    };
    invoiceEvent: { create: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    invoice: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: customerId }) },
      invoice: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      invoiceItem: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      invoiceEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
      invoice: { findUnique: jest.fn() },
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

  /** Makes `tx.invoice.update` echo the persisted totals into a full model. */
  const echoUpdatedInvoice = (items: unknown[]) =>
    tx.invoice.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(buildInvoice({ ...data, items })),
    );

  describe('addItem', () => {
    it('adds an item, recomputes totals and writes ITEM_ADDED', async () => {
      const existingItem = buildItem();
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          taxRate: new Prisma.Decimal(11),
          items: [existingItem],
        }),
      );
      const newItem = buildItem({
        id: 'item-2',
        description: 'Support',
        quantity: new Prisma.Decimal(3),
        unitPrice: new Prisma.Decimal(10),
        lineTotal: new Prisma.Decimal(30),
      });
      tx.invoiceItem.findMany.mockResolvedValue([existingItem, newItem]);
      echoUpdatedInvoice([existingItem, newItem]);

      const result = await service.addItem(
        invoiceId,
        { description: 'Support', quantity: 3, unitPrice: 10 },
        actorId,
      );

      const createArg = (
        tx.invoiceItem.create.mock.calls as Array<
          [{ data: { lineTotal: Prisma.Decimal; description: string } }]
        >
      )[0][0];
      expect(createArg.data.description).toBe('Support');
      expect(Number(createArg.data.lineTotal)).toBe(30);

      const updateArg = (
        tx.invoice.update.mock.calls as Array<
          [
            {
              data: {
                subtotal: Prisma.Decimal;
                taxAmount: Prisma.Decimal;
                total: Prisma.Decimal;
              };
            },
          ]
        >
      )[0][0];
      expect(Number(updateArg.data.subtotal)).toBe(331);
      expect(Number(updateArg.data.taxAmount)).toBe(36.41);
      expect(Number(updateArg.data.total)).toBe(367.41);

      const eventArg = (
        tx.invoiceEvent.create.mock.calls as Array<
          [{ data: { type: string; actorUserId: string } }]
        >
      )[0][0];
      expect(eventArg.data.type).toBe(InvoiceEventType.ITEM_ADDED);
      expect(eventArg.data.actorUserId).toBe(actorId);

      expect(result.total).toBe(367.41);
      expect(result.items).toHaveLength(2);
    });

    it('rejects adding to a non-editable (PAID) invoice with 409', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({ status: InvoiceStatus.PAID }),
      );

      await expect(
        service.addItem(invoiceId, {
          description: 'Support',
          quantity: 1,
          unitPrice: 10,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.invoiceItem.create).not.toHaveBeenCalled();
      expect(tx.invoiceEvent.create).not.toHaveBeenCalled();
    });

    it('throws NotFound when the invoice does not exist', async () => {
      tx.invoice.findUnique.mockResolvedValue(null);

      await expect(
        service.addItem(invoiceId, {
          description: 'Support',
          quantity: 1,
          unitPrice: 10,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.invoiceItem.create).not.toHaveBeenCalled();
    });
  });

  describe('updateItem', () => {
    it('updates a line, recomputes totals and writes ITEM_UPDATED', async () => {
      const item1 = buildItem();
      const item2 = buildItem({
        id: 'item-2',
        description: 'Support',
        quantity: new Prisma.Decimal(3),
        unitPrice: new Prisma.Decimal(10),
        lineTotal: new Prisma.Decimal(30),
      });
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          taxRate: new Prisma.Decimal(11),
          items: [item1, item2],
        }),
      );
      // After bumping item1 to quantity 4: lineTotal 602.
      const bumped = buildItem({
        quantity: new Prisma.Decimal(4),
        lineTotal: new Prisma.Decimal(602),
      });
      tx.invoiceItem.findMany.mockResolvedValue([bumped, item2]);
      echoUpdatedInvoice([bumped, item2]);

      const result = await service.updateItem(
        invoiceId,
        'item-1',
        { quantity: 4 },
        actorId,
      );

      const updateItemArg = (
        tx.invoiceItem.update.mock.calls as Array<
          [{ where: { id: string }; data: { lineTotal: Prisma.Decimal } }]
        >
      )[0][0];
      expect(updateItemArg.where.id).toBe('item-1');
      expect(Number(updateItemArg.data.lineTotal)).toBe(602);

      const updateArg = (
        tx.invoice.update.mock.calls as Array<
          [{ data: { subtotal: Prisma.Decimal; total: Prisma.Decimal } }]
        >
      )[0][0];
      expect(Number(updateArg.data.subtotal)).toBe(632); // 602 + 30
      expect(Number(updateArg.data.total)).toBe(701.52); // 632 * 1.11

      const eventArg = (
        tx.invoiceEvent.create.mock.calls as Array<[{ data: { type: string } }]>
      )[0][0];
      expect(eventArg.data.type).toBe(InvoiceEventType.ITEM_UPDATED);
      expect(result.total).toBe(701.52);
    });

    it('rejects updating on a non-editable (VOID) invoice with 409', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({ status: InvoiceStatus.VOID, items: [buildItem()] }),
      );

      await expect(
        service.updateItem(invoiceId, 'item-1', { quantity: 4 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.invoiceItem.update).not.toHaveBeenCalled();
    });

    it('throws NotFound when the item is not on the invoice', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({ items: [buildItem()] }),
      );

      await expect(
        service.updateItem(invoiceId, 'item-999', { quantity: 4 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.invoiceItem.update).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('removes a line, recomputes totals and writes ITEM_REMOVED', async () => {
      const item1 = buildItem();
      const item2 = buildItem({
        id: 'item-2',
        description: 'Support',
        quantity: new Prisma.Decimal(3),
        unitPrice: new Prisma.Decimal(10),
        lineTotal: new Prisma.Decimal(30),
      });
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          taxRate: new Prisma.Decimal(11),
          items: [item1, item2],
        }),
      );
      tx.invoiceItem.findMany.mockResolvedValue([item1]);
      echoUpdatedInvoice([item1]);

      const result = await service.removeItem(invoiceId, 'item-2', actorId);

      const deleteArg = (
        tx.invoiceItem.delete.mock.calls as Array<[{ where: { id: string } }]>
      )[0][0];
      expect(deleteArg.where.id).toBe('item-2');

      const updateArg = (
        tx.invoice.update.mock.calls as Array<
          [{ data: { subtotal: Prisma.Decimal; total: Prisma.Decimal } }]
        >
      )[0][0];
      expect(Number(updateArg.data.subtotal)).toBe(301);
      expect(Number(updateArg.data.total)).toBe(334.11); // 301 * 1.11

      const eventArg = (
        tx.invoiceEvent.create.mock.calls as Array<[{ data: { type: string } }]>
      )[0][0];
      expect(eventArg.data.type).toBe(InvoiceEventType.ITEM_REMOVED);
      expect(result).toBeUndefined();
    });

    it('rejects removing from a non-editable (PAID) invoice with 409', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({ status: InvoiceStatus.PAID, items: [buildItem()] }),
      );

      await expect(
        service.removeItem(invoiceId, 'item-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.invoiceItem.delete).not.toHaveBeenCalled();
    });

    it('throws NotFound when the item is not on the invoice', async () => {
      tx.invoice.findUnique.mockResolvedValue(
        buildInvoice({ items: [buildItem()] }),
      );

      await expect(
        service.removeItem(invoiceId, 'item-999'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.invoiceItem.delete).not.toHaveBeenCalled();
    });
  });
});
