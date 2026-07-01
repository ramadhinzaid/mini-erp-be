import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvoiceEventType, InvoiceStatus, Prisma, Role } from '@prisma/client';
import { AuthenticatedUser } from 'src/common/types/authenticated-user';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import {
  computeInvoiceTotals,
  deriveDisplayStatus,
  InvoicesService,
  isTransitionAllowed,
} from './invoices.service';

const customerId = '11111111-1111-1111-1111-111111111111';
const invoiceId = '33333333-3333-3333-3333-333333333333';
const actorId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const admin: AuthenticatedUser = {
  id: actorId,
  email: 'admin@test.local',
  role: Role.ADMIN,
};
const manager: AuthenticatedUser = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  email: 'manager@test.local',
  role: Role.MANAGER,
};

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

    it('surfaces OVERDUE as displayStatus for a past-due SENT invoice without mutating status', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          status: InvoiceStatus.SENT,
          dueDate: new Date('2000-01-01T00:00:00Z'),
        }),
      );

      const result = await service.findById(invoiceId);

      expect(result.status).toBe(InvoiceStatus.SENT); // stored value untouched
      expect(result.displayStatus).toBe(InvoiceStatus.OVERDUE);
    });

    it('keeps displayStatus equal to status for a not-yet-due SENT invoice', async () => {
      prisma.invoice.findUnique.mockResolvedValue(
        buildInvoice({
          status: InvoiceStatus.SENT,
          dueDate: new Date('2999-01-01T00:00:00Z'),
        }),
      );

      const result = await service.findById(invoiceId);

      expect(result.status).toBe(InvoiceStatus.SENT);
      expect(result.displayStatus).toBe(InvoiceStatus.SENT);
    });
  });

  describe('isTransitionAllowed (lifecycle matrix)', () => {
    it('allows the four legal manual transitions', () => {
      expect(isTransitionAllowed(InvoiceStatus.DRAFT, InvoiceStatus.SENT)).toBe(
        true,
      );
      expect(isTransitionAllowed(InvoiceStatus.DRAFT, InvoiceStatus.VOID)).toBe(
        true,
      );
      expect(isTransitionAllowed(InvoiceStatus.SENT, InvoiceStatus.PAID)).toBe(
        true,
      );
      expect(isTransitionAllowed(InvoiceStatus.SENT, InvoiceStatus.VOID)).toBe(
        true,
      );
    });

    it('rejects transitions out of terminal states', () => {
      for (const to of [
        InvoiceStatus.DRAFT,
        InvoiceStatus.SENT,
        InvoiceStatus.PAID,
        InvoiceStatus.VOID,
      ]) {
        expect(isTransitionAllowed(InvoiceStatus.PAID, to)).toBe(false);
        expect(isTransitionAllowed(InvoiceStatus.VOID, to)).toBe(false);
      }
    });

    it('rejects skipping SENT (DRAFT→PAID) and same-state moves', () => {
      expect(isTransitionAllowed(InvoiceStatus.DRAFT, InvoiceStatus.PAID)).toBe(
        false,
      );
      expect(isTransitionAllowed(InvoiceStatus.SENT, InvoiceStatus.SENT)).toBe(
        false,
      );
    });

    it('never allows OVERDUE as a source or a target', () => {
      expect(
        isTransitionAllowed(InvoiceStatus.SENT, InvoiceStatus.OVERDUE),
      ).toBe(false);
      expect(
        isTransitionAllowed(InvoiceStatus.OVERDUE, InvoiceStatus.PAID),
      ).toBe(false);
    });
  });

  describe('deriveDisplayStatus (derived OVERDUE)', () => {
    const now = new Date('2026-07-01T00:00:00Z');

    it('reports OVERDUE for a SENT invoice past its dueDate', () => {
      expect(
        deriveDisplayStatus(
          { status: InvoiceStatus.SENT, dueDate: new Date('2026-06-01') },
          now,
        ),
      ).toBe(InvoiceStatus.OVERDUE);
    });

    it('leaves a SENT invoice that is not yet due as SENT', () => {
      expect(
        deriveDisplayStatus(
          { status: InvoiceStatus.SENT, dueDate: new Date('2026-08-01') },
          now,
        ),
      ).toBe(InvoiceStatus.SENT);
    });

    it('leaves a SENT invoice with no dueDate as SENT', () => {
      expect(
        deriveDisplayStatus({ status: InvoiceStatus.SENT, dueDate: null }, now),
      ).toBe(InvoiceStatus.SENT);
    });

    it('never derives OVERDUE for non-SENT statuses even when past due', () => {
      const pastDue = new Date('2026-06-01');
      for (const status of [
        InvoiceStatus.DRAFT,
        InvoiceStatus.PAID,
        InvoiceStatus.VOID,
      ]) {
        expect(deriveDisplayStatus({ status, dueDate: pastDue }, now)).toBe(
          status,
        );
      }
    });
  });

  describe('updateStatus', () => {
    /** Wires the tx mocks so an invoice in `from` can be transitioned. */
    const arrange = (from: InvoiceStatus, overrides = {}) => {
      const existing = buildInvoice({ status: from, ...overrides });
      tx.invoice.findUnique.mockResolvedValue(existing);
      tx.invoice.update.mockImplementation(
        ({ data }: { data: { status: InvoiceStatus } }) =>
          Promise.resolve(buildInvoice({ ...existing, status: data.status })),
      );
      return existing;
    };

    const legal: Array<[InvoiceStatus, InvoiceStatus]> = [
      [InvoiceStatus.DRAFT, InvoiceStatus.SENT],
      [InvoiceStatus.DRAFT, InvoiceStatus.VOID],
      [InvoiceStatus.SENT, InvoiceStatus.PAID],
      [InvoiceStatus.SENT, InvoiceStatus.VOID],
    ];

    it.each(legal)(
      'persists %s → %s and appends a STATUS_CHANGED event',
      async (from, to) => {
        arrange(from);

        const result = await service.updateStatus(invoiceId, to, admin);

        expect(tx.invoice.update).toHaveBeenCalledWith({
          where: { id: invoiceId },
          data: { status: to },
          include: { items: true },
        });
        expect(result.status).toBe(to);

        const eventCalls = tx.invoiceEvent.create.mock.calls as Array<
          [
            {
              data: {
                type: string;
                fromStatus: string;
                toStatus: string;
                actorUserId: string;
              };
            },
          ]
        >;
        expect(eventCalls).toHaveLength(1);
        expect(eventCalls[0][0].data.type).toBe(
          InvoiceEventType.STATUS_CHANGED,
        );
        expect(eventCalls[0][0].data.fromStatus).toBe(from);
        expect(eventCalls[0][0].data.toStatus).toBe(to);
        expect(eventCalls[0][0].data.actorUserId).toBe(admin.id);
      },
    );

    const illegal: Array<[InvoiceStatus, InvoiceStatus]> = [
      [InvoiceStatus.DRAFT, InvoiceStatus.PAID],
      [InvoiceStatus.PAID, InvoiceStatus.SENT],
      [InvoiceStatus.VOID, InvoiceStatus.SENT],
      [InvoiceStatus.SENT, InvoiceStatus.SENT],
    ];

    it.each(illegal)(
      'throws 409 Conflict for the illegal transition %s → %s',
      async (from, to) => {
        arrange(from);

        await expect(
          service.updateStatus(invoiceId, to, admin),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(tx.invoice.update).not.toHaveBeenCalled();
        expect(tx.invoiceEvent.create).not.toHaveBeenCalled();
      },
    );

    it('rejects OVERDUE as manual input with 400 before touching the db', async () => {
      await expect(
        service.updateStatus(invoiceId, InvoiceStatus.OVERDUE, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.invoice.findUnique).not.toHaveBeenCalled();
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });

    it('forbids a MANAGER from voiding an invoice (403)', async () => {
      await expect(
        service.updateStatus(invoiceId, InvoiceStatus.VOID, manager),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.invoice.update).not.toHaveBeenCalled();
      expect(tx.invoiceEvent.create).not.toHaveBeenCalled();
    });

    it('allows an ADMIN to void an invoice', async () => {
      arrange(InvoiceStatus.SENT);

      const result = await service.updateStatus(
        invoiceId,
        InvoiceStatus.VOID,
        admin,
      );

      expect(result.status).toBe(InvoiceStatus.VOID);
      expect(tx.invoiceEvent.create).toHaveBeenCalledTimes(1);
    });

    it('lets a MANAGER perform a non-VOID transition (SENT → PAID)', async () => {
      arrange(InvoiceStatus.SENT);

      const result = await service.updateStatus(
        invoiceId,
        InvoiceStatus.PAID,
        manager,
      );

      expect(result.status).toBe(InvoiceStatus.PAID);
    });

    it('throws NotFound when the invoice does not exist', async () => {
      tx.invoice.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(invoiceId, InvoiceStatus.SENT, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });
  });
});
