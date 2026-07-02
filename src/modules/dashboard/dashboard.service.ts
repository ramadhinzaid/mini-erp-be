import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  DashboardSummaryEntity,
  InvoiceStatusCountsEntity,
  RecentInvoiceEntity,
} from './entities/dashboard-summary.entity';

/** How many invoices the "recent activity" list returns. */
const RECENT_INVOICE_LIMIT = 5;

/**
 * Statuses whose invoices count as outstanding money: `SENT` (which includes
 * invoices displayed as OVERDUE, since OVERDUE is derived from SENT) plus any
 * rows already persisted with the `OVERDUE` status.
 */
const OUTSTANDING_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.SENT,
  InvoiceStatus.OVERDUE,
];

/** A zeroed set of per-status counts — the graceful "empty database" baseline. */
const emptyCounts = (): InvoiceStatusCountsEntity => ({
  DRAFT: 0,
  SENT: 0,
  PAID: 0,
  VOID: 0,
  OVERDUE: 0,
});

/**
 * Maps a persisted invoice status to the status shown on the dashboard: a
 * `SENT` invoice whose `dueDate` has passed is displayed as `OVERDUE`. Pure and
 * exported so the derivation rule is unit-testable in isolation.
 */
export function deriveDisplayStatus(
  status: InvoiceStatus,
  dueDate: Date | null,
  now: Date = new Date(),
): InvoiceStatus {
  if (
    status === InvoiceStatus.SENT &&
    dueDate !== null &&
    dueDate.getTime() < now.getTime()
  ) {
    return InvoiceStatus.OVERDUE;
  }
  return status;
}

/** Converts a nullable Prisma `Decimal` money field to a plain number (0 when null). */
const toNumber = (value: Prisma.Decimal | null | undefined): number =>
  value == null ? 0 : Number(value);

/**
 * Owns the dashboard aggregation logic. Reads exclusively through
 * `PrismaService` using aggregate/groupBy queries and keeps the controller
 * thin. Every metric degrades gracefully to zero/empty when no data exists.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the dashboard summary: paid revenue, outstanding balance, per-status
   * invoice counts (with derived OVERDUE), active-customer count and the latest
   * few invoices. Returns zeroed aggregates and an empty list on an empty DB.
   */
  async getSummary(): Promise<DashboardSummaryEntity> {
    const now = new Date();

    const [
      revenueAgg,
      outstandingAgg,
      grouped,
      overdueCount,
      customerCount,
      recent,
    ] = await Promise.all([
      this.prisma.invoice.aggregate({
        _sum: { total: true },
        where: { status: InvoiceStatus.PAID },
      }),
      this.prisma.invoice.aggregate({
        _sum: { total: true },
        where: { status: { in: OUTSTANDING_STATUSES } },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.invoice.count({
        where: { status: InvoiceStatus.SENT, dueDate: { lt: now } },
      }),
      this.prisma.customer.count({ where: { isActive: true } }),
      this.prisma.invoice.findMany({
        take: RECENT_INVOICE_LIMIT,
        orderBy: { issueDate: 'desc' },
        select: {
          number: true,
          total: true,
          status: true,
          issueDate: true,
          dueDate: true,
          customer: { select: { name: true } },
        },
      }),
    ]);

    return {
      revenue: toNumber(revenueAgg._sum.total),
      outstanding: toNumber(outstandingAgg._sum.total),
      invoiceCounts: this.buildCounts(grouped, overdueCount),
      customerCount,
      recentInvoices: recent.map((invoice) =>
        this.toRecentInvoice(invoice, now),
      ),
    };
  }

  /**
   * Folds a Prisma `groupBy` result into per-status counts. `SENT` invoices
   * past their due date are re-bucketed from `SENT` into `OVERDUE`, on top of
   * any rows already persisted with the `OVERDUE` status.
   */
  private buildCounts(
    grouped: Array<{
      status: InvoiceStatus;
      _count: { _all: number } | number;
    }>,
    overdueSentCount: number,
  ): InvoiceStatusCountsEntity {
    const counts = emptyCounts();
    for (const group of grouped) {
      const count =
        typeof group._count === 'number' ? group._count : group._count._all;
      counts[group.status] += count;
    }
    counts.OVERDUE += overdueSentCount;
    counts.SENT = Math.max(0, counts.SENT - overdueSentCount);
    return counts;
  }

  /** Shapes a selected invoice row into the compact recent-invoice entity. */
  private toRecentInvoice(
    invoice: {
      number: string;
      total: Prisma.Decimal | null;
      status: InvoiceStatus;
      issueDate: Date;
      dueDate: Date | null;
      customer: { name: string } | null;
    },
    now: Date,
  ): RecentInvoiceEntity {
    return {
      number: invoice.number,
      customerName: invoice.customer?.name ?? '',
      total: toNumber(invoice.total),
      status: deriveDisplayStatus(invoice.status, invoice.dueDate, now),
      issueDate: invoice.issueDate,
    };
  }
}
