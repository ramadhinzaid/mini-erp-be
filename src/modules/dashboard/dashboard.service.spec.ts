import { Test } from '@nestjs/testing';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { DashboardService, deriveDisplayStatus } from './dashboard.service';

/**
 * Unit tests for the dashboard aggregation service against a fully mocked
 * `PrismaService`. They cover the revenue/outstanding sums, per-status counts
 * (including the derived OVERDUE re-bucketing), the graceful empty-database
 * case and the recent-invoices shape/limit.
 */
describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    invoice: {
      aggregate: jest.Mock;
      groupBy: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
    customer: { count: jest.Mock };
  };

  // Values returned by the two aggregate() calls, keyed by intent.
  let paidTotal: Prisma.Decimal | null;
  let outstandingTotal: Prisma.Decimal | null;

  beforeEach(async () => {
    paidTotal = new Prisma.Decimal(0);
    outstandingTotal = new Prisma.Decimal(0);

    prisma = {
      invoice: {
        aggregate: jest.fn(({ where }: { where: { status: unknown } }) =>
          Promise.resolve({
            _sum: {
              total:
                where.status === InvoiceStatus.PAID
                  ? paidTotal
                  : outstandingTotal,
            },
          }),
        ),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      customer: { count: jest.fn().mockResolvedValue(0) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(DashboardService);
  });

  describe('deriveDisplayStatus', () => {
    const now = new Date('2026-07-02T00:00:00Z');

    it('shows a SENT invoice past its due date as OVERDUE', () => {
      expect(
        deriveDisplayStatus(
          InvoiceStatus.SENT,
          new Date('2026-06-01T00:00:00Z'),
          now,
        ),
      ).toBe(InvoiceStatus.OVERDUE);
    });

    it('keeps a SENT invoice not yet due as SENT', () => {
      expect(
        deriveDisplayStatus(
          InvoiceStatus.SENT,
          new Date('2026-08-01T00:00:00Z'),
          now,
        ),
      ).toBe(InvoiceStatus.SENT);
    });

    it('keeps a SENT invoice with no due date as SENT', () => {
      expect(deriveDisplayStatus(InvoiceStatus.SENT, null, now)).toBe(
        InvoiceStatus.SENT,
      );
    });

    it('never re-buckets non-SENT statuses', () => {
      const past = new Date('2000-01-01T00:00:00Z');
      expect(deriveDisplayStatus(InvoiceStatus.PAID, past, now)).toBe(
        InvoiceStatus.PAID,
      );
      expect(deriveDisplayStatus(InvoiceStatus.DRAFT, past, now)).toBe(
        InvoiceStatus.DRAFT,
      );
    });
  });

  describe('getSummary', () => {
    it('returns the paid revenue and outstanding sums as numbers', async () => {
      paidTotal = new Prisma.Decimal('12500.50');
      outstandingTotal = new Prisma.Decimal('3400.00');

      const summary = await service.getSummary();

      expect(summary.revenue).toBe(12500.5);
      expect(summary.outstanding).toBe(3400);

      // revenue sums only PAID invoices.
      expect(prisma.invoice.aggregate).toHaveBeenCalledWith({
        _sum: { total: true },
        where: { status: InvoiceStatus.PAID },
      });
      // outstanding sums SENT + persisted OVERDUE invoices.
      expect(prisma.invoice.aggregate).toHaveBeenCalledWith({
        _sum: { total: true },
        where: { status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] } },
      });
    });

    it('counts invoices per status and derives OVERDUE from past-due SENT', async () => {
      prisma.invoice.groupBy.mockResolvedValue([
        { status: InvoiceStatus.DRAFT, _count: { _all: 3 } },
        { status: InvoiceStatus.SENT, _count: { _all: 5 } },
        { status: InvoiceStatus.PAID, _count: { _all: 10 } },
        { status: InvoiceStatus.VOID, _count: { _all: 1 } },
        { status: InvoiceStatus.OVERDUE, _count: { _all: 1 } },
      ]);
      // Two of the five SENT invoices are past due.
      prisma.invoice.count.mockResolvedValue(2);

      const summary = await service.getSummary();

      expect(summary.invoiceCounts).toEqual({
        DRAFT: 3,
        SENT: 3, // 5 SENT minus 2 re-bucketed as OVERDUE
        PAID: 10,
        VOID: 1,
        OVERDUE: 3, // 1 persisted OVERDUE + 2 derived from SENT
      });

      // OVERDUE derivation queries SENT invoices past their due date.
      const countCalls = prisma.invoice.count.mock.calls as Array<
        [{ where: { status: InvoiceStatus; dueDate: { lt: Date } } }]
      >;
      const countArg = countCalls[0][0];
      expect(countArg.where.status).toBe(InvoiceStatus.SENT);
      expect(countArg.where.dueDate.lt).toBeInstanceOf(Date);
    });

    it('never lets the SENT bucket go negative', async () => {
      prisma.invoice.groupBy.mockResolvedValue([
        { status: InvoiceStatus.SENT, _count: { _all: 2 } },
      ]);
      // Defensive: more "overdue" reported than SENT rows.
      prisma.invoice.count.mockResolvedValue(5);

      const summary = await service.getSummary();

      expect(summary.invoiceCounts.SENT).toBe(0);
      expect(summary.invoiceCounts.OVERDUE).toBe(5);
    });

    it('returns zeroed aggregates and empty lists on an empty database', async () => {
      paidTotal = null;
      outstandingTotal = null;
      // All prisma mocks default to empty/zero from beforeEach.

      const summary = await service.getSummary();

      expect(summary.revenue).toBe(0);
      expect(summary.outstanding).toBe(0);
      expect(summary.customerCount).toBe(0);
      expect(summary.invoiceCounts).toEqual({
        DRAFT: 0,
        SENT: 0,
        PAID: 0,
        VOID: 0,
        OVERDUE: 0,
      });
      expect(summary.recentInvoices).toEqual([]);
    });

    it('counts active customers', async () => {
      prisma.customer.count.mockResolvedValue(42);

      const summary = await service.getSummary();

      expect(summary.customerCount).toBe(42);
      expect(prisma.customer.count).toHaveBeenCalledWith({
        where: { isActive: true },
      });
    });

    it('returns the latest invoices (limit 5) with a mapped, derived shape', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-7',
          number: 'INV-2026-0007',
          total: new Prisma.Decimal('367.41'),
          status: InvoiceStatus.SENT,
          issueDate: new Date('2026-07-01T00:00:00Z'),
          dueDate: new Date('2026-06-01T00:00:00Z'), // past due -> OVERDUE
          customer: { name: 'Acme Corporation' },
        },
        {
          id: 'inv-6',
          number: 'INV-2026-0006',
          total: new Prisma.Decimal('100'),
          status: InvoiceStatus.PAID,
          issueDate: new Date('2026-06-20T00:00:00Z'),
          dueDate: null,
          customer: { name: 'Globex' },
        },
      ]);

      const summary = await service.getSummary();

      expect(summary.recentInvoices).toEqual([
        {
          id: 'inv-7',
          number: 'INV-2026-0007',
          customerName: 'Acme Corporation',
          total: 367.41,
          status: InvoiceStatus.OVERDUE,
          issueDate: new Date('2026-07-01T00:00:00Z'),
        },
        {
          id: 'inv-6',
          number: 'INV-2026-0006',
          customerName: 'Globex',
          total: 100,
          status: InvoiceStatus.PAID,
          issueDate: new Date('2026-06-20T00:00:00Z'),
        },
      ]);

      // Query limits to 5, newest first, and includes the customer name.
      const findCalls = prisma.invoice.findMany.mock.calls as Array<
        [
          {
            take: number;
            orderBy: { issueDate: string };
            select: { id: boolean; customer: { select: { name: boolean } } };
          },
        ]
      >;
      const findArg = findCalls[0][0];
      expect(findArg.take).toBe(5);
      expect(findArg.orderBy).toEqual({ issueDate: 'desc' });
      expect(findArg.select.id).toBe(true);
      expect(findArg.select.customer.select.name).toBe(true);
    });
  });
});
